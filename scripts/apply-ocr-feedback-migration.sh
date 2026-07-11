#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="${MIGRATION:-$ROOT/postgres/migrations/20260711_ocr_feedback.sql}"

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the PostgreSQL connection string.}"

if command -v psql >/dev/null 2>&1; then
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$MIGRATION:/migration.sql:ro" postgres:17-alpine \
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f /migration.sql
else
  echo "Neither psql nor docker is available. Install one of them and retry." >&2
  exit 1
fi

echo "OCR feedback migration applied."
