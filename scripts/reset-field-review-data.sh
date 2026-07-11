#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTRUCTION_ID="${INSTRUCTION_ID:-REVIEW-MULTI-001}"
DB_URL="${DB_URL:-}"
DOCKER_SERVICE="${DOCKER_SERVICE:-postgres}"
DB_USER="${DB_USER:-production_user}"
DB_NAME="${DB_NAME:-production_db}"

if [ "${ALLOW_NON_LOCAL:-false}" != "true" ] && [ -n "$DB_URL" ]; then
  echo "Refusing to reset DB_URL unless ALLOW_NON_LOCAL=true is set." >&2
  echo "This reset deletes field-review scan, packing, picking, report, and audit records." >&2
  exit 1
fi

SQL=$(cat <<SQL
BEGIN;

WITH target AS (
  SELECT id
  FROM shipping_instructions
  WHERE instruction_id = '$INSTRUCTION_ID'
),
deleted_records AS (
  DELETE FROM picking_records
  WHERE picking_instruction_id IN (
    SELECT id FROM picking_instructions WHERE shipping_instruction_id = (SELECT id FROM target)
  )
  RETURNING id
),
deleted_packing AS (
  DELETE FROM packing_records
  WHERE shipping_instruction_id = (SELECT id FROM target)
  RETURNING id
),
deleted_picking AS (
  DELETE FROM picking_instructions
  WHERE shipping_instruction_id = (SELECT id FROM target)
  RETURNING id
),
deleted_audit AS (
  DELETE FROM shipping_audit_events
  WHERE shipping_instruction_id = (SELECT id FROM target)
  RETURNING id
)
UPDATE shipping_instructions
SET status = 'pending',
    updated_at = CURRENT_TIMESTAMP
WHERE id = (SELECT id FROM target);

COMMIT;

SELECT si.id,
       si.instruction_id,
       si.status,
       COUNT(DISTINCT l.id) AS line_count,
       COUNT(DISTINCT a.id) AS allocation_count,
       COALESCE(SUM(a.shipped_quantity), 0)::int AS allocated_quantity
FROM shipping_instructions si
LEFT JOIN shipping_instruction_lines l ON l.shipping_instruction_id = si.id
LEFT JOIN shipping_lot_allocations a ON a.shipping_instruction_line_id = l.id AND a.status = 'shipped'
WHERE si.instruction_id = '$INSTRUCTION_ID'
GROUP BY si.id, si.instruction_id, si.status;
SQL
)

if [ -n "$DB_URL" ]; then
  if command -v psql >/dev/null 2>&1; then
    printf '%s\n' "$SQL" | psql "$DB_URL" -v ON_ERROR_STOP=1
  else
    printf '%s\n' "$SQL" | docker run --rm -i postgres:17-alpine psql "$DB_URL" -v ON_ERROR_STOP=1
  fi
else
  cd "$ROOT"
  printf '%s\n' "$SQL" | docker compose exec -T "$DOCKER_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1
fi

echo "Field review demo data reset completed."
