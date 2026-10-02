#!/usr/bin/env bash
set -euo pipefail

ASSEMBLY_AI_API_URL="https://api.assemblyai.com/v2/transcript"
PRIMARY_ENV_KEY="ASSEMBLY_AI_API_KEY"
PROJECT_NAME="aither"
KEYCHAIN_SERVICE="assemblyai-aither-api-key"
DEFAULT_ENV_FILE=".env.local"
CURRENT_USER="${USER:-$(id -un 2>/dev/null || echo "$UID")}"

usage() {
  cat <<'EOF'
Usage:
  scripts/assemblyai-keychain-setup.sh [--key KEY] [--env-file PATH] [--keychain-service NAME] [--non-interactive]

Description:
  1) Liest den AssemblyAI API-Key (aither) aus --key, Env oder Env-Datei.
  2) Testet den Key gegen die AssemblyAI API (erwartet 401/422, nicht 403).
  3) Speichert den Key bei Erfolg in der macOS Keychain.
  4) Ersetzt den Plaintext-Key in der Env-Datei durch die Service-Referenz.

Key-Reihenfolge:
  --key > $ASSEMBLY_AI_API_KEY > Env-Datei > interaktive Eingabe

Optionen:
  --non-interactive    Keine interaktive Eingabe; Fehler, wenn kein Key gefunden wird.

Hinweis (FR-010): .env.local darf danach nur noch die Keychain-Referenz
ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE enthalten, nie den Plaintext-Key.
EOF
}

# Strip surrounding quotes and whitespace from a key value.
trim_key() {
  local value="$1"
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [[ "$value" == \"*\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  fi
  if [[ "$value" == \'*\' ]]; then
    value="${value#\'}"
    value="${value%\'}"
  fi
  printf '%s' "$value"
}

read_from_env_file() {
  local env_file="$1"
  local key="$2"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  local line
  line=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" | tail -n 1 || true)
  if [[ -z "$line" ]]; then
    return 1
  fi

  local raw
  raw="${line#*=}"
  # Only strip inline comments preceded by whitespace to avoid truncating # in values
  raw="${raw%%[[:space:]]#*}"
  trim_key "$raw"
}

assert_dependencies() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "Fehler: curl ist nicht installiert." >&2
    exit 1
  fi

  if ! command -v security >/dev/null 2>&1; then
    echo "Fehler: macOS security CLI wurde nicht gefunden." >&2
    exit 1
  fi
}

API_KEY=""
ENV_FILE="$DEFAULT_ENV_FILE"
NON_INTERACTIVE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)
      if [[ $# -lt 2 ]]; then
        echo "Fehler: --key erfordert einen Wert." >&2
        exit 1
      fi
      API_KEY="$2"
      shift 2
      ;;
    --env-file)
      if [[ $# -lt 2 ]]; then
        echo "Fehler: --env-file erfordert einen Wert." >&2
        exit 1
      fi
      ENV_FILE="$2"
      shift 2
      ;;
    --keychain-service)
      if [[ $# -lt 2 ]]; then
        echo "Fehler: --keychain-service erfordert einen Wert." >&2
        exit 1
      fi
      KEYCHAIN_SERVICE="$2"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unbekanntes Argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

assert_dependencies

if [[ -z "$API_KEY" && -n "${ASSEMBLY_AI_API_KEY:-}" ]]; then
  API_KEY="${ASSEMBLY_AI_API_KEY}"
fi

if [[ -z "$API_KEY" ]]; then
  API_KEY="$(read_from_env_file "$ENV_FILE" "$PRIMARY_ENV_KEY" || true)"
fi

if [[ -z "$API_KEY" && -f ".env" ]]; then
  API_KEY="$(read_from_env_file ".env" "$PRIMARY_ENV_KEY" || true)"
fi

if [[ -z "$API_KEY" ]]; then
  if [[ -n "$NON_INTERACTIVE" ]]; then
    echo "Fehler: Kein Key gefunden und --non-interactive gesetzt." >&2
    exit 1
  fi
  read -r -s -p "AssemblyAI API-Key fuer ${PROJECT_NAME} eingeben: " API_KEY
  echo ""
fi

API_KEY="$(trim_key "$API_KEY")"

if [[ -z "$API_KEY" ]]; then
  echo "Fehler: Kein Key gefunden." >&2
  exit 1
fi

# Probe the API: a minimal POST with a valid key yields 400/422 (validation of
# the empty audio_url), an invalid key yields 401/403. Anything else indicates
# a connectivity issue. The key is sent via header from stdin, never in
# process arguments.
http_status=$(printf 'authorization: %s\n' "$API_KEY" | curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$ASSEMBLY_AI_API_URL" \
  -H @- \
  -H "Content-Type: application/json" \
  --data-binary '{"audio_url":""}' || true)

case "$http_status" in
  400|422)
    # Key accepted; the empty audio_url is rejected as expected
    ;;
  401|403)
    echo "Fehler: AssemblyAI hat den Key abgelehnt (HTTP ${http_status})." >&2
    exit 1
    ;;
  *)
    echo "Fehler: Unerwartete AssemblyAI-Antwort (HTTP ${http_status}). Konnektivitaet pruefen." >&2
    exit 1
    ;;
esac

# Store key in Keychain; read password from stdin to avoid exposing it in process arguments.
# Note: -w reads from stdin; -U is NOT used here to avoid it being interpreted as the password.
printf '%s\n' "$API_KEY" | security add-generic-password -a "$CURRENT_USER" -s "$KEYCHAIN_SERVICE" -w >/dev/null 2>&1
stored_key=$(security find-generic-password -a "$CURRENT_USER" -s "$KEYCHAIN_SERVICE" -w)

if [[ "$stored_key" != "$API_KEY" ]]; then
  echo "Fehler: Key konnte nicht korrekt aus der Keychain gelesen werden." >&2
  exit 1
fi

echo "Key-Test erfolgreich."
echo "Key wurde in der Keychain gespeichert."
echo "Service: $KEYCHAIN_SERVICE"

# Replace the plaintext key in the env file with the Keychain service reference
if [[ -f "$ENV_FILE" ]] && grep -qE "^[[:space:]]*${PRIMARY_ENV_KEY}[[:space:]]*=" "$ENV_FILE"; then
  sed -i '' "s|^[[:space:]]*${PRIMARY_ENV_KEY}[[:space:]]*=.*|ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE=${KEYCHAIN_SERVICE}|" "$ENV_FILE"
  echo "Plaintext-Key in ${ENV_FILE} wurde durch die Keychain-Referenz ersetzt."
else
  echo "Hinweis: ${ENV_FILE} enthaelt keinen ${PRIMARY_ENV_KEY}-Eintrag."
  echo "Fuege dort hinzu: ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE=${KEYCHAIN_SERVICE}"
fi