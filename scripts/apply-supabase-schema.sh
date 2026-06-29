#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_JSON="${SUPABASE_PROJECT_RESPONSE_FILE:-$ROOT/supabase-project.json}"
SCHEMA_FILE="${SUPABASE_SCHEMA_FILE:-$ROOT/supabase-schema.sql}"

if [ ! -f "$PROJECT_JSON" ]; then
  echo "Missing $PROJECT_JSON. Run scripts/create-supabase-project.sh first." >&2
  exit 1
fi

if [ ! -f "$SCHEMA_FILE" ]; then
  "$ROOT/scripts/prepare-supabase-schema.sh" "$SCHEMA_FILE"
fi

REF="$(jq -r '.ref // .id' "$PROJECT_JSON")"
REGION="$(jq -r '.region // "ap-northeast-1"' "$PROJECT_JSON")"
: "${SUPABASE_DB_PASSWORD:?Set SUPABASE_DB_PASSWORD to the Supabase database password.}"

DB_NAME="${SUPABASE_DB_NAME:-postgres}"

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  DB_URL="$SUPABASE_DB_URL"
elif [ "${SUPABASE_USE_POOLER:-false}" = "true" ]; then
  POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-0-${REGION}.pooler.supabase.com}"
  POOLER_PORT="${SUPABASE_POOLER_PORT:-5432}"
  POOLER_USER="${SUPABASE_POOLER_USER:-postgres.${REF}}"
  DB_URL="postgresql://${POOLER_USER}:${SUPABASE_DB_PASSWORD}@${POOLER_HOST}:${POOLER_PORT}/${DB_NAME}?sslmode=require"
else
  DB_HOST="${SUPABASE_DB_HOST:-db.${REF}.supabase.co}"
  DB_PORT="${SUPABASE_DB_PORT:-5432}"
  DB_USER="${SUPABASE_DB_USER:-postgres}"
  DB_URL="postgresql://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"
fi

if command -v psql >/dev/null 2>&1; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SCHEMA_FILE"
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$SCHEMA_FILE:/schema.sql:ro" \
    postgres:17-alpine \
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f /schema.sql
else
  echo "Neither psql nor docker is available. Install one of them and retry." >&2
  exit 1
fi

echo "Supabase schema applied."