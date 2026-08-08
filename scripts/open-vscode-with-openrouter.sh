#!/usr/bin/env bash
set -euo pipefail

KEYCHAIN_SERVICE="openrouter-aither-api-key"
CURRENT_USER="${USER:-$(id -un 2>/dev/null || echo "$UID")}"
CODE_BIN="${CODE_BIN:-$(command -v code || true)}"
PRINT_ENV_ONLY=""

usage() {
  cat <<'EOF'
Usage:
  scripts/open-vscode-with-openrouter.sh [--print-env] [--] [code-args...]

Description:
  Liest den OpenRouter API-Key aus der macOS Keychain und startet VS Code so,
  dass der VS-Code-Prozess AITHER_OPENROUTER_API_KEY und OPENROUTER_API_KEY in
  seiner Umgebung erbt.

Optionen:
  --print-env    Gibt nur die gesetzten Variablennamen und deren Laengen aus.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --print-env)
      PRINT_ENV_ONLY="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

if [[ -z "$CODE_BIN" ]]; then
  echo "Fehler: 'code' wurde nicht gefunden. Installiere zuerst den VS Code Shell Command." >&2
  exit 1
fi

OPENROUTER_TOKEN="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$CURRENT_USER" -w 2>/dev/null || true)"
if [[ -z "${OPENROUTER_TOKEN:-}" ]]; then
  echo "Fehler: OpenRouter API-Key nicht in der Keychain gefunden (Service: $KEYCHAIN_SERVICE, Account: $CURRENT_USER)." >&2
  exit 1
fi

export AITHER_OPENROUTER_API_KEY="$OPENROUTER_TOKEN"
export OPENROUTER_API_KEY="$OPENROUTER_TOKEN"

if [[ -n "$PRINT_ENV_ONLY" ]]; then
  printf 'AITHER_OPENROUTER_API_KEY=%s\n' "${#AITHER_OPENROUTER_API_KEY}"
  printf 'OPENROUTER_API_KEY=%s\n' "${#OPENROUTER_API_KEY}"
  exit 0
fi

if [[ $# -eq 0 ]]; then
  set -- .
fi

exec "$CODE_BIN" "$@"
