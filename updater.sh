#!/bin/bash

# Path to project (adjust!)
PROJECT_DIR="/path/to/your/aither"

cd "$PROJECT_DIR" || exit 1

# Check if pull is needed (fetch + comparison)
git fetch origin
LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
BASE=$(git merge-base @ @{u})

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$(date): Already up to date."
  exit 0
elif [ "$LOCAL" = "$BASE" ]; then
  echo "$(date): Update available – pulling it."
  git pull origin main  # Or your branch
  npm ci  # Or npm install --production
  npm run build
  pm2 restart nextjs-app  # Or pkill -f next && npm run start (adjust!)
  echo "$(date): Update successful!"
else
  echo "$(date): Diverged – check manually."
  exit 1
fi
