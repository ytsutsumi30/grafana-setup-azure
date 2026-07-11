#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${BASE:-http://localhost:8080}"
INSTRUCTION_ID="${INSTRUCTION_ID:-REVIEW-MULTI-001}"
DOCKER_SERVICE="${DOCKER_SERVICE:-postgres}"
DB_USER="${DB_USER:-production_user}"
DB_NAME="${DB_NAME:-production_db}"

case "$BASE" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *)
    if [ "${ALLOW_NON_LOCAL:-false}" != "true" ]; then
      echo "Refusing to run scenario against non-local BASE: $BASE" >&2
      echo "This script mutates shipping, picking, packing, scan, report, and audit data." >&2
      exit 1
    fi
    ;;
esac

cd "$ROOT"

./scripts/seed-field-review-data.sh

docker compose exec -T "$DOCKER_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
WITH target AS (
  SELECT id FROM shipping_instructions WHERE instruction_id = '$INSTRUCTION_ID'
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
SQL

node - "$BASE" "$INSTRUCTION_ID" <<'NODE'
const assert = require('node:assert/strict');

const [base, instructionId] = process.argv.slice(2);

async function request(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = await res.text().catch(() => null);
  }
  return { status: res.status, body: data };
}

async function get(path) {
  return request('GET', path);
}

function fail(message, detail) {
  console.error(`ERROR: ${message}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

async function expectStatus(label, response, status) {
  if (response.status !== status) fail(`${label}: expected ${status}, got ${response.status}`, response.body);
}

(async () => {
  console.log(`Field review API scenario: ${base}`);
  console.log(`Instruction: ${instructionId}`);

  const list = await get(`/api/shipping-instructions?instruction_id=${encodeURIComponent(instructionId)}`);
  await expectStatus('instruction list', list, 200);
  const instruction = list.body.find((row) => row.instruction_id === instructionId);
  if (!instruction) fail(`Instruction ${instructionId} not found`, list.body);
  console.log(`Instruction id=${instruction.id}`);

  const start = await request('POST', '/api/picking-instructions', {
    shipping_instruction_id: instruction.id,
    picker_name: 'field-review-api'
  });
  await expectStatus('create picking instruction', start, 201);
  const pickingId = start.body.id;
  console.log(`Picking id=${pickingId} total=${start.body.total_quantity}`);

  const scans = [
    { qr_code: 'QR-REVIEW-P1-L1-A', picked_quantity: 8, expectedCode: 'picked' },
    { qr_code: 'QR-REVIEW-P1-L1-A', picked_quantity: 1, expectedCode: 'duplicate_scan' },
    { qr_code: 'QR-REVIEW-NG-P2', picked_quantity: 1, expectedCode: 'unallocated_lot' },
    { qr_code: 'QR-REVIEW-P1-L2-A', picked_quantity: 7, expectedCode: 'picked' },
    { qr_code: 'QR-REVIEW-P2-L1-A', picked_quantity: 10, expectedCode: 'picked' }
  ];

  for (const scan of scans) {
    const { expectedCode, ...body } = scan;
    const response = await request('POST', `/api/picking-instructions/${pickingId}/scan`, body);
    await expectStatus(`scan ${scan.qr_code}`, response, 200);
    assert.equal(response.body.code, expectedCode, `scan ${scan.qr_code} code`);
    console.log(`Scan ${scan.qr_code}: ${response.body.code}`);
  }

  const ppsAfterScan = await get(`/api/shipping-instructions/${instruction.id}/pps-status`);
  await expectStatus('pps after scan', ppsAfterScan, 200);
  assert.equal(Number(ppsAfterScan.body.picking.picked_quantity), 25, 'picked quantity should be 25');
  assert.ok(ppsAfterScan.body.completion.blockers.some((blocker) => blocker.code === 'picking_not_completed'), 'picking completion should still be required');

  const completePicking = await request('PATCH', `/api/picking-instructions/${pickingId}/complete`);
  await expectStatus('complete picking', completePicking, 200);
  console.log('Picking completed');

  const createPacking = await request('POST', '/api/packing-records', {
    shipping_instruction_id: instruction.id,
    picking_instruction_id: pickingId,
    packer_name: 'field-review-api',
    packed_quantity: 25,
    box_count: 2,
    packaging_type: 'review',
    lot_numbers: 'REVIEW-P1-L1, REVIEW-P1-L2, REVIEW-P2-L1',
    notes: 'field review API scenario'
  });
  await expectStatus('create packing record', createPacking, 201);

  const completePacking = await request('PATCH', `/api/packing-records/${createPacking.body.id}/complete`, {
    packed_quantity: 25,
    box_count: 2,
    packaging_type: 'review',
    lot_numbers: 'REVIEW-P1-L1, REVIEW-P1-L2, REVIEW-P2-L1',
    notes: 'field review API scenario'
  });
  await expectStatus('complete packing', completePacking, 200);
  console.log('Packing completed');

  const completion = await get(`/api/shipping-instructions/${instruction.id}/completion-status`);
  await expectStatus('completion status', completion, 200);
  assert.equal(completion.body.can_complete, true, 'shipment should be completable');
  assert.ok(completion.body.warnings.some((warning) => warning.code === 'ng_or_warning_scans_exist'), 'NG/duplicate warning should be visible');

  const completeShipment = await request('PATCH', `/api/shipping-instructions/${instruction.id}/complete-shipment`, {
    comment: 'field review API scenario'
  });
  await expectStatus('complete shipment', completeShipment, 200);
  assert.equal(completeShipment.body.success, true, 'shipment completion should succeed');
  console.log('Shipment completed');

  const report = await request('POST', `/api/shipping-instructions/${instruction.id}/report-events`, {
    report_type: 'inspection_result',
    output_method: 'html_print',
    revision_label: 'field-review-api',
    comment: 'field review API scenario'
  });
  await expectStatus('report event', report, 201);
  assert.equal(report.body.success, true, 'report event should be recorded');
  console.log(`Report event recorded issue=${report.body.issue_number}`);

  const history = await get(`/api/shipping-instructions/${instruction.id}/history`);
  await expectStatus('history', history, 200);
  const eventTypes = new Set(history.body.audit_events.map((event) => event.event_type));
  for (const eventType of ['pps_started', 'qr_scan_ok', 'qr_scan_duplicate', 'qr_scan_ng', 'picking_completed', 'shipment_completed', 'report_printed']) {
    assert.ok(eventTypes.has(eventType), `history should include ${eventType}`);
  }
  assert.ok(history.body.records.length >= 5, 'history should include scan records');
  console.log(`History records=${history.body.records.length} audit=${history.body.audit_events.length}`);

  console.log('Field review API scenario completed.');
})().catch((error) => {
  fail(error.message, error);
});
NODE
