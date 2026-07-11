#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="${SQL_FILE:-$ROOT/postgres/scripts/seed-field-review-data.sql}"

DB_URL="${DB_URL:-}"
DOCKER_SERVICE="${DOCKER_SERVICE:-postgres}"
DB_USER="${DB_USER:-production_user}"
DB_NAME="${DB_NAME:-production_db}"

if [ ! -f "$SQL_FILE" ]; then
  echo "Missing SQL file: $SQL_FILE" >&2
  exit 1
fi

if [ "${ALLOW_NON_LOCAL:-false}" != "true" ] && [ -n "$DB_URL" ]; then
  echo "Refusing to run against DB_URL unless ALLOW_NON_LOCAL=true is set." >&2
  echo "This seed is intended for local field-review data preparation." >&2
  exit 1
fi

if [ -n "$DB_URL" ]; then
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"
  else
    docker run --rm -i -v "$SQL_FILE:/seed.sql:ro" postgres:17-alpine \
      psql "$DB_URL" -v ON_ERROR_STOP=1 -f /seed.sql
  fi
else
  cd "$ROOT"
  docker compose exec -T "$DOCKER_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$SQL_FILE"
fi

echo "Field review demo data seed completed."
