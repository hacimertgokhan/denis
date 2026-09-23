#!/bin/sh
# Denis Cloud container entrypoint.
#   DB_PUSH=1   apply the Drizzle schema to DATABASE_URL before starting (idempotent)
set -e
if [ "${DB_PUSH:-0}" = "1" ]; then
  echo "Applying database schema..."
  (cd /app/migrate && node_modules/.bin/drizzle-kit push --force)
fi
cd /app/web
exec node server.js
