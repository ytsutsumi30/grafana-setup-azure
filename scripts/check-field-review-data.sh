#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DB_URL="${DB_URL:-}"
DOCKER_SERVICE="${DOCKER_SERVICE:-postgres}"
DB_USER="${DB_USER:-production_user}"
DB_NAME="${DB_NAME:-production_db}"

SQL=$(cat <<'SQL'
\echo '== table readiness =='
SELECT table_name,
       CASE WHEN to_regclass(table_name) IS NULL THEN 'missing' ELSE 'ok' END AS status
FROM (VALUES
  ('shipping_instructions'),
  ('shipping_instruction_lines'),
  ('lot_inventory'),
  ('shipping_lot_allocations'),
  ('picking_instructions'),
  ('picking_records'),
  ('qr_units'),
  ('shipping_audit_events')
) AS t(table_name);

\echo ''
\echo '== shipping instruction summary =='
SELECT si.id,
       si.instruction_id,
       si.customer_name,
       si.status,
       COUNT(DISTINCT l.id) AS line_count,
       COUNT(DISTINCT a.id) AS allocation_count,
       COALESCE(SUM(a.shipped_quantity), 0)::int AS allocated_quantity
FROM shipping_instructions si
LEFT JOIN shipping_instruction_lines l ON l.shipping_instruction_id = si.id
LEFT JOIN shipping_lot_allocations a ON a.shipping_instruction_line_id = l.id
GROUP BY si.id, si.instruction_id, si.customer_name, si.status
ORDER BY si.id
LIMIT 20;

\echo ''
\echo '== multi-line / multi-lot candidates =='
SELECT si.id,
       si.instruction_id,
       COUNT(DISTINCT l.id) AS line_count,
       COUNT(DISTINCT a.id) AS allocation_count
FROM shipping_instructions si
JOIN shipping_instruction_lines l ON l.shipping_instruction_id = si.id
LEFT JOIN shipping_lot_allocations a ON a.shipping_instruction_line_id = l.id
GROUP BY si.id, si.instruction_id
HAVING COUNT(DISTINCT l.id) >= 2 OR COUNT(DISTINCT a.id) >= 2
ORDER BY line_count DESC, allocation_count DESC, si.id
LIMIT 10;

\echo ''
\echo '== available lot candidates =='
SELECT p.product_code,
       p.product_name,
       li.id AS lot_inventory_id,
       li.lot_number,
       li.quantity,
       li.location,
       li.status
FROM lot_inventory li
JOIN products p ON p.id = li.product_id
ORDER BY p.product_code, li.lot_number
LIMIT 30;

\echo ''
\echo '== recent picking / scan records =='
SELECT pr.id,
       pr.picking_instruction_id,
       p.product_code,
       pr.lot_number,
       pr.qr_code,
       pr.scan_source,
       pr.picked_quantity,
       pr.status,
       pr.scanned_at
FROM picking_records pr
LEFT JOIN products p ON p.id = pr.product_id
ORDER BY pr.scanned_at DESC, pr.id DESC
LIMIT 30;

\echo ''
\echo '== recent audit events =='
SELECT id,
       shipping_instruction_id,
       event_type,
       event_status,
       lot_number,
       qr_code,
       quantity,
       reason_code,
       comment,
       occurred_at
FROM shipping_audit_events
ORDER BY occurred_at DESC, id DESC
LIMIT 30;

\echo ''
\echo '== report issue events =='
SELECT shipping_instruction_id,
       after_data->>'report_type' AS report_type,
       after_data->>'revision_label' AS revision_label,
       after_data->>'issue_number' AS issue_number,
       occurred_at
FROM shipping_audit_events
WHERE event_type = 'report_printed'
ORDER BY occurred_at DESC, id DESC
LIMIT 20;
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
