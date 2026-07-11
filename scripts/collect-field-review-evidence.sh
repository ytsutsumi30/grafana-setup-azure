#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/review-evidence/$(date +%Y%m%d-%H%M%S)}"
BASE="${BASE:-http://localhost:8080}"
INSTRUCTION_ID="${INSTRUCTION_ID:-REVIEW-MULTI-001}"
DOCKER_SERVICE="${DOCKER_SERVICE:-postgres}"
DB_USER="${DB_USER:-production_user}"
DB_NAME="${DB_NAME:-production_db}"

mkdir -p "$OUT_DIR"
cd "$ROOT"

{
  echo "field_review_evidence_collected_at=$(date -Is)"
  echo "base=$BASE"
  echo "instruction_id=$INSTRUCTION_ID"
  echo "git_head=$(git rev-parse --short HEAD 2>/dev/null || true)"
  echo "git_branch=$(git branch --show-current 2>/dev/null || true)"
} > "$OUT_DIR/metadata.txt"

./scripts/check-field-review-data.sh > "$OUT_DIR/db-summary.txt"
./scripts/check-field-review-api.sh > "$OUT_DIR/api-summary.txt"

docker compose ps > "$OUT_DIR/docker-compose-ps.txt"
docker compose logs --tail=300 api > "$OUT_DIR/api.log" 2>&1 || true
docker compose logs --tail=300 web > "$OUT_DIR/web.log" 2>&1 || true
docker compose logs --tail=300 "$DOCKER_SERVICE" > "$OUT_DIR/postgres.log" 2>&1 || true

docker compose exec -T "$DOCKER_SERVICE" psql -q -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 > "$OUT_DIR/review-records.tsv" <<SQL
\\pset format unaligned
\\pset fieldsep '\\t'
\\pset tuples_only on
WITH target AS (
  SELECT id FROM shipping_instructions WHERE instruction_id = '$INSTRUCTION_ID'
),
latest_picking AS (
  SELECT id
  FROM picking_instructions
  WHERE shipping_instruction_id = (SELECT id FROM target)
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 'shipping' AS section,
       si.id::text,
       si.instruction_id,
       si.status,
       si.quantity::text,
       si.updated_at::text
FROM shipping_instructions si
WHERE si.id = (SELECT id FROM target)
UNION ALL
SELECT 'line',
       l.id::text,
       p.product_code,
       l.status,
       l.quantity::text,
       l.shipped_quantity::text
FROM shipping_instruction_lines l
JOIN products p ON p.id = l.product_id
WHERE l.shipping_instruction_id = (SELECT id FROM target)
UNION ALL
SELECT 'allocation',
       a.id::text,
       p.product_code,
       a.lot_number,
       a.shipped_quantity::text,
       a.status
FROM shipping_lot_allocations a
JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
JOIN products p ON p.id = a.product_id
WHERE l.shipping_instruction_id = (SELECT id FROM target)
UNION ALL
SELECT 'scan',
       pr.id::text,
       COALESCE(p.product_code, ''),
       COALESCE(pr.lot_number, ''),
       COALESCE(pr.qr_code, ''),
       pr.status
FROM picking_records pr
LEFT JOIN products p ON p.id = pr.product_id
WHERE pr.picking_instruction_id = (SELECT id FROM latest_picking)
UNION ALL
SELECT 'audit',
       e.id::text,
       e.event_type,
       e.event_status,
       COALESCE(e.lot_number, ''),
       e.occurred_at::text
FROM shipping_audit_events e
WHERE e.shipping_instruction_id = (SELECT id FROM target)
ORDER BY section, id;
SQL

echo "Field review evidence collected: $OUT_DIR"
