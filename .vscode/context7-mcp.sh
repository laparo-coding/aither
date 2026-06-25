#!/usr/bin/env bash
# Context7 MCP launcher — loads CONTEXT7_API_KEY from .env.local
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

if [ -z "${CONTEXT7_API_KEY:-}" ]; then
  echo "Error: CONTEXT7_API_KEY is empty or not set in $ENV_FILE" >&2
  exit 1
fi

export CONTEXT7_API_KEY
exec npx -y @upstash/context7-mcp@latest
