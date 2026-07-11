#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TFVARS="${TFVARS:-$ROOT/infra/terraform/terraform.tfvars}"
MIGRATION="${MIGRATION:-$ROOT/postgres/migrations/20260707_qr_units.sql}"

if [ ! -f "$TFVARS" ]; then
  echo "Missing terraform tfvars: $TFVARS" >&2
  exit 1
fi
if [ ! -f "$MIGRATION" ]; then
  echo "Missing migration SQL: $MIGRATION" >&2
  exit 1
fi

DB_URL="$(TFVARS="$TFVARS" python3 - <<'PY'
import os
from pathlib import Path
from urllib.parse import quote

values = {}
for line in Path(os.environ["TFVARS"]).read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip().strip('"').strip("'")

host = values["supabase_db_host"]
port = values.get("supabase_db_port", "5432")
name = values.get("supabase_db_name", "postgres")
user = quote(values["supabase_db_user"])
password = quote(values["supabase_db_password"])
print(f"postgresql://{user}:{password}@{host}:{port}/{name}?sslmode=require")
PY
)"

if command -v psql >/dev/null 2>&1; then
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"
else
  docker run --rm \
    -v "$MIGRATION:/migration.sql:ro" \
    postgres:17-alpine \
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f /migration.sql
fi

echo "Database migration applied."
