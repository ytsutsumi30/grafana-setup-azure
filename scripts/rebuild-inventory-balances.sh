#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_URL="${DB_URL:-}"
DOCKER_SERVICE="${DOCKER_SERVICE:-postgres}"
DB_USER="${DB_USER:-production_user}"
DB_NAME="${DB_NAME:-production_db}"
MIGRATION_FILE="${MIGRATION_FILE:-$ROOT/postgres/migrations/20260708_inventory_foundation.sql}"

if [ "${ALLOW_NON_LOCAL:-false}" != "true" ] && [ -n "$DB_URL" ]; then
  echo "Refusing to rebuild inventory balances against DB_URL unless ALLOW_NON_LOCAL=true is set." >&2
  echo "This script rebuilds inventory_balances and writes initial_balance transactions." >&2
  exit 1
fi

SQL=$(cat <<'SQL'
BEGIN;

INSERT INTO locations (location_code, location_name, location_type)
SELECT DISTINCT TRIM(location), TRIM(location), 'warehouse'
FROM lot_inventory
WHERE location IS NOT NULL AND TRIM(location) <> ''
ON CONFLICT (location_code) DO NOTHING;

UPDATE lot_inventory li
SET location_id = loc.id,
    inventory_status = COALESCE(li.inventory_status, li.status, 'available')
FROM locations loc
WHERE loc.location_code = li.location
  AND (li.location_id IS NULL OR li.inventory_status IS NULL);

UPDATE qr_units qu
SET location_id = loc.id,
    current_quantity = COALESCE(qu.current_quantity, qu.quantity)
FROM locations loc
WHERE loc.location_code = qu.location
  AND (qu.location_id IS NULL OR qu.current_quantity IS NULL);

INSERT INTO inventory_transactions (
    transaction_type,
    transaction_status,
    product_id,
    lot_inventory_id,
    lot_number,
    location_id,
    location_code,
    quantity_delta,
    quantity_after,
    source_type,
    source_id,
    reason_code,
    comment,
    created_by
)
SELECT
    'initial_balance',
    'posted',
    li.product_id,
    li.id,
    li.lot_number,
    li.location_id,
    li.location,
    li.quantity,
    li.quantity,
    'lot_inventory',
    li.id,
    'rebuild_inventory_balances',
    '既存 lot_inventory から初期在庫を作成',
    'rebuild-inventory-balances'
FROM lot_inventory li
WHERE NOT EXISTS (
    SELECT 1
    FROM inventory_transactions it
    WHERE it.transaction_type = 'initial_balance'
      AND it.source_type = 'lot_inventory'
      AND it.source_id = li.id
);

TRUNCATE inventory_balances RESTART IDENTITY;

INSERT INTO inventory_balances (
    product_id,
    lot_inventory_id,
    qr_unit_id,
    lot_number,
    location_id,
    location_code,
    inventory_status,
    quantity,
    last_transaction_id,
    updated_at
)
SELECT
    it.product_id,
    it.lot_inventory_id,
    it.qr_unit_id,
    it.lot_number,
    it.location_id,
    it.location_code,
    CASE
        WHEN it.transaction_type IN ('shipping_allocation') THEN 'allocated'
        WHEN it.transaction_type IN ('shipping_complete') THEN 'shipped'
        WHEN it.transaction_type IN ('manufacturing_consumption') THEN 'consumed'
        WHEN it.transaction_type IN ('hold') THEN 'on_hold'
        WHEN it.transaction_type IN ('defective') THEN 'defective'
        ELSE COALESCE(li.inventory_status, li.status, 'available')
    END AS inventory_status,
    SUM(it.quantity_delta)::int AS quantity,
    MAX(it.id) AS last_transaction_id,
    CURRENT_TIMESTAMP
FROM inventory_transactions it
LEFT JOIN lot_inventory li ON li.id = it.lot_inventory_id
WHERE it.transaction_status = 'posted'
GROUP BY
    it.product_id,
    it.lot_inventory_id,
    it.qr_unit_id,
    it.lot_number,
    it.location_id,
    it.location_code,
    CASE
        WHEN it.transaction_type IN ('shipping_allocation') THEN 'allocated'
        WHEN it.transaction_type IN ('shipping_complete') THEN 'shipped'
        WHEN it.transaction_type IN ('manufacturing_consumption') THEN 'consumed'
        WHEN it.transaction_type IN ('hold') THEN 'on_hold'
        WHEN it.transaction_type IN ('defective') THEN 'defective'
        ELSE COALESCE(li.inventory_status, li.status, 'available')
    END
HAVING SUM(it.quantity_delta) <> 0;

COMMIT;

SELECT COUNT(*)::int AS balance_count,
       COALESCE(SUM(quantity), 0)::int AS balance_quantity
FROM inventory_balances;
SQL
)

run_psql() {
  if [ -n "$DB_URL" ]; then
    if command -v psql >/dev/null 2>&1; then
      psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"
    else
      docker run --rm -i postgres:17-alpine psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"
    fi
  else
    cd "$ROOT"
    docker compose exec -T "$DOCKER_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
  fi
}

if [ ! -f "$MIGRATION_FILE" ]; then
  echo "Missing migration file: $MIGRATION_FILE" >&2
  exit 1
fi

if [ -n "$DB_URL" ]; then
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION_FILE"
    printf '%s\n' "$SQL" | psql "$DB_URL" -v ON_ERROR_STOP=1
  else
    docker run --rm -i -v "$MIGRATION_FILE:/migration.sql:ro" postgres:17-alpine \
      psql "$DB_URL" -v ON_ERROR_STOP=1 -f /migration.sql
    printf '%s\n' "$SQL" | docker run --rm -i postgres:17-alpine psql "$DB_URL" -v ON_ERROR_STOP=1
  fi
else
  cd "$ROOT"
  docker compose exec -T "$DOCKER_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$MIGRATION_FILE"
  printf '%s\n' "$SQL" | docker compose exec -T "$DOCKER_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
fi

echo "Inventory balances rebuilt."
