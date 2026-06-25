#!/usr/bin/env bash
# Codacy MCP launcher — loads CODACY_ACCOUNT_TOKEN from .env.local
# This file is safe to commit; it contains no secrets.
set -euo pipefail

ENV_FILE="${1:-$PWD/.env.local}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

# Source .env.local (handles KEY="value" and KEY=value formats)
# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

if [ -z "${CODACY_ACCOUNT_TOKEN:-}" ]; then
  echo "Error: CODACY_ACCOUNT_TOKEN is empty or not set in $ENV_FILE" >&2
  exit 1
fi

export CODACY_ACCOUNT_TOKEN
exec npx -y @codacy/codacy-mcp@latest
