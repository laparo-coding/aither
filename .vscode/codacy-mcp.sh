#!/usr/bin/env bash
# Codacy MCP launcher — loads CODACY_ACCOUNT_TOKEN from .env.local or macOS Keychain
# This file is safe to commit; it contains no secrets.
set -euo pipefail

ENV_FILE="${1:-$PWD/.env.local}"

# Optional repo override from .env.local (KEY="value" and KEY=value formats)
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  . "$ENV_FILE"
  set +a
fi

# Fallback to macOS Keychain if not set in .env.local
if [ -z "${CODACY_ACCOUNT_TOKEN:-}" ]; then
  CODACY_ACCOUNT_TOKEN="$(security find-generic-password -a "$USER" -s "CODACY_ACCOUNT_TOKEN" -w 2>/dev/null || true)"
fi

if [ -z "${CODACY_ACCOUNT_TOKEN:-}" ]; then
  echo "Error: CODACY_ACCOUNT_TOKEN is not set in $ENV_FILE and not found in macOS Keychain service CODACY_ACCOUNT_TOKEN" >&2
  exit 1
fi

export CODACY_ACCOUNT_TOKEN
exec npx -y @codacy/codacy-mcp@latest
