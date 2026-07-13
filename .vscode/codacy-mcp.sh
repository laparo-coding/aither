#!/usr/bin/env bash
# Codacy MCP launcher — loads CODACY_ACCOUNT_TOKEN from macOS Keychain
# This file is safe to commit; it contains no secrets.
set -euo pipefail

CODACY_ACCOUNT_TOKEN=$(security find-generic-password -s "com.aither.codacy" -a "mcp" -w 2>/dev/null)

if [ -z "${CODACY_ACCOUNT_TOKEN:-}" ]; then
  echo "Error: CODACY_ACCOUNT_TOKEN not found in Keychain (service: com.aither.codacy, account: mcp)" >&2
  exit 1
fi

export CODACY_ACCOUNT_TOKEN
exec npx -y @codacy/codacy-mcp@latest
