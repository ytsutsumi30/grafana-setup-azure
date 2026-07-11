#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/supabase-schema.sql}"

cat \
  "$ROOT/postgres/init/01-init.sql" \
  "$ROOT/postgres/init/02-qr-inspection-tables.sql" \
  "$ROOT/postgres/init/03-inspectors-table.sql" \
  "$ROOT/postgres/init/03-new-qc-tools-tables.sql" \
  "$ROOT/postgres/init/04-monitoring-tables.sql" \
  "$ROOT/postgres/init/05-pps-lot-tables.sql" \
  "$ROOT/postgres/init/06-shipping-lines-tables.sql" \
  "$ROOT/postgres/init/15-ocr-feedback.sql" \
  "$ROOT/postgres/init/07-qr-units.sql" \
  "$ROOT/postgres/init/08-shipping-audit-events.sql" \
  "$ROOT/api/migrations/003_create_product_components_and_inventory.sql" \
  "$ROOT/postgres/migrations/fix-prod001-qr-codes.sql" \
  | sed '/GRANT ALL PRIVILEGES/d' > "$OUT"

echo "Wrote $OUT"
