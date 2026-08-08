#!/usr/bin/env bash
set -euo pipefail

# OpenRouter Keychain Setup for Aither
# Stores the OpenRouter API key in macOS Keychain after validation.

OPENROUTER_API_URL="https://openrouter.ai/api/v1/models"
PRIMARY_ENV_KEY="AITHER_OPENROUTER_API_KEY"
FALLBACK_ENV_KEY="OPENROUTER_API_KEY"
PROJECT_NAME="aither"
KEYCHAIN_SERVICE="openrouter-aither-api-key"
DEFAULT_ENV_FILE=".env.local"
CURRENT_USER="${USER:-$(id -un 2>/dev/null || echo "$UID")}"

usage() {
  cat <<'EOF'
Usage:
  scripts/openrouter-keychain-setup.sh [--token TOKEN] [--env-file PATH] [--keychain-service NAME] [--non-interactive]

Description:
  1) Liest den OpenRouter API-Key aus --token, AITHER_OPENROUTER_API_KEY,
     alternativ dem Legacy-Fallback OPENROUTER_API_KEY, oder der Env-Datei.
  2) Testet den Key gegen die OpenRouter /v1/models API.
  3) Speichert den Key bei Erfolg in der macOS Keychain.

Token-Reihenfolge:
  --token > $AITHER_OPENROUTER_API_KEY > $OPENROUTER_API_KEY (Legacy) > Env-Datei > interaktive Eingabe

Optionen:
  --non-interactive    Keine interaktive Eingabe; Fehler, wenn kein Token gefunden wird.
EOF
}

# Strip surrounding quotes and whitespace from a token value.
trim_token() {
  local value="$1"
  # Remove surrounding whitespace first
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  # Strip one pair of surrounding double quotes
  if [[ "$value" == \"*\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  fi
  # Strip one pair of surrounding single quotes
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
  # Match KEY= or KEY ="..." or KEY = value (whitespace around = allowed)
  line=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$env_file" | tail -n 1 || true)
  if [[ -z "$line" ]]; then
    return 1
  fi

  local raw
  raw="${line#*=}"
  # Strip inline comments (only when preceded by whitespace or start)
  raw="${raw%%#*}"
  trim_token "$raw"
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

TOKEN=""
ENV_FILE="$DEFAULT_ENV_FILE"
NON_INTERACTIVE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --keychain-service)
      KEYCHAIN_SERVICE="${2:-}"
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

if [[ -z "$TOKEN" && -n "${AITHER_OPENROUTER_API_KEY:-}" ]]; then
  TOKEN="${AITHER_OPENROUTER_API_KEY}"
fi

if [[ -z "$TOKEN" && -n "${OPENROUTER_API_KEY:-}" ]]; then
  TOKEN="${OPENROUTER_API_KEY}"
fi

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(read_from_env_file "$ENV_FILE" "$PRIMARY_ENV_KEY" || true)"
fi

if [[ -z "$TOKEN" ]]; then
  TOKEN="$(read_from_env_file "$ENV_FILE" "$FALLBACK_ENV_KEY" || true)"
fi

if [[ -z "$TOKEN" ]]; then
  if [[ -n "$NON_INTERACTIVE" ]]; then
    echo "Fehler: Kein Token gefunden und --non-interactive gesetzt." >&2
    exit 1
  fi
  read -r -s -p "OpenRouter API Key fuer ${PROJECT_NAME} eingeben: " TOKEN
  echo ""
fi

TOKEN="$(trim_token "$TOKEN")"

if [[ -z "$TOKEN" ]]; then
  echo "Fehler: Kein Token gefunden." >&2
  exit 1
fi

# Validate the token against OpenRouter's models endpoint.
http_code=$(curl -sS -o /dev/null -w "%{http_code}" \
  "$OPENROUTER_API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  --connect-timeout 10 \
  --max-time 30) || true

if [[ "$http_code" != "200" ]]; then
  echo "Fehler: Token-Test fehlgeschlagen (HTTP $http_code)." >&2
  echo "Erwartet HTTP 200 von $OPENROUTER_API_URL" >&2
  exit 1
fi

# Store in macOS Keychain.
security add-generic-password -a "$CURRENT_USER" -s "$KEYCHAIN_SERVICE" -w "$TOKEN" -U >/dev/null
stored_token=$(security find-generic-password -a "$CURRENT_USER" -s "$KEYCHAIN_SERVICE" -w)

if [[ "$stored_token" != "$TOKEN" ]]; then
  echo "Fehler: Token konnte nicht korrekt aus der Keychain gelesen werden." >&2
  exit 1
fi

echo "Token-Test erfolgreich (HTTP 200)."
echo "Token wurde in der Keychain gespeichert."
echo "Service: $KEYCHAIN_SERVICE"
echo ""
echo "Optional fuer die aktuelle Shell:"
echo "export AITHER_OPENROUTER_API_KEY=\"\$(security find-generic-password -a \"$CURRENT_USER\" -s \"$KEYCHAIN_SERVICE\" -w)\""
