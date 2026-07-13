#!/usr/bin/env bash
# Context7 MCP launcher — loads CONTEXT7_API_KEY from macOS Keychain
# This file is safe to commit; it contains no secrets.
set -euo pipefail

CONTEXT7_API_KEY=$(security find-generic-password -s "com.aither.context7" -a "mcp" -w 2>/dev/null)

if [ -z "${CONTEXT7_API_KEY:-}" ]; then
  echo "Error: CONTEXT7_API_KEY not found in Keychain (service: com.aither.context7, account: mcp)" >&2
  exit 1
fi

export CONTEXT7_API_KEY
exec npx -y @upstash/context7-mcp@latest
