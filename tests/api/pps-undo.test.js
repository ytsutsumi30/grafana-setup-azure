/**
 * PPS QR スキャン取消 E2E。
 *
 * ローカル docker compose の DB に一時出荷指示を作成し、HTTP API 経由で
 * OK スキャン、直前取消、数量復元、監査ログを確認する。
 * Azure公開URLや本番相当環境を BASE に指定しないこと。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const BASE = process.env.BASE || 'http://localhost:8080';
const DB_CONTAINER = process.env.DB_CONTAINER || 'shipping-inspection-postgres';

async function get(path) {
  const res = await fetch(BASE + path);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

async function send(method, path, json) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json)
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

function psql(sql) {
  const result = spawnSync('docker', [
    'exec',
    '-i',
    DB_CONTAINER,
    'psql',
    '-U',
    'production_user',
    '-d',
    'production_db',
    '-v',
    'ON_ERROR_STOP=1',
    '-tA'
  ], {
    input: sql,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function createFixture() {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const instructionId = `TEST-UNDO-${suffix}`;
  const lotNumber = `TEST-UNDO-LOT-${suffix}`;
  const row = psql(`
WITH refs AS (
  SELECT
    (SELECT id FROM products WHERE product_code = 'PROD001') AS product_id,
    (SELECT id FROM shipping_locations ORDER BY id LIMIT 1) AS shipping_location_id,
    (SELECT id FROM delivery_locations ORDER BY id LIMIT 1) AS delivery_location_id
),
si AS (
  INSERT INTO shipping_instructions (
    instruction_id, product_id, quantity, shipping_date,
    shipping_location_id, delivery_location_id, customer_name,
    priority, status, notes
  )
  SELECT
    '${instructionId}', product_id, 2, CURRENT_DATE,
    shipping_location_id, delivery_location_id, 'PPS取消E2E',
    'normal', 'picking', 'contract test fixture'
  FROM refs
  RETURNING id, product_id
),
line AS (
  INSERT INTO shipping_instruction_lines (
    shipping_instruction_id, product_id, quantity, shipped_quantity, status
  )
  SELECT id, product_id, 2, 2, 'completed'
  FROM si
  RETURNING id, shipping_instruction_id, product_id
),
lot AS (
  INSERT INTO lot_inventory (product_id, lot_number, quantity, location, status, notes)
  SELECT product_id, '${lotNumber}', 20, 'TEST', 'available', 'contract test fixture'
  FROM refs
  RETURNING id, product_id, lot_number
),
allocation AS (
  INSERT INTO shipping_lot_allocations (
    shipping_instruction_line_id, lot_inventory_id, lot_number,
    product_id, shipped_quantity, operator_name, status
  )
  SELECT line.id, lot.id, lot.lot_number, line.product_id, 2, 'contract-test', 'shipped'
  FROM line, lot
  RETURNING id
),
pi AS (
  INSERT INTO picking_instructions (
    picking_id, shipping_instruction_id, picker_name,
    total_quantity, picked_quantity, status, started_at, notes
  )
  SELECT 'PICK-${instructionId}', id, 'contract-test', 2, 0, 'in_progress', CURRENT_TIMESTAMP, 'contract test fixture'
  FROM si
  RETURNING id, shipping_instruction_id
)
SELECT si.id || ',' || pi.id || ',' || allocation.id || ',' || '${lotNumber}'
FROM si, pi, allocation;
`);
  const [shippingId, pickingId, allocationId, createdLot] = row.split(',');
  return {
    shippingId: Number(shippingId),
    pickingId: Number(pickingId),
    allocationId: Number(allocationId),
    lotNumber: createdLot,
    instructionId
  };
}

function cleanupFixture(fixture) {
  if (!fixture?.shippingId) return;
  psql(`
DELETE FROM picking_records WHERE picking_instruction_id IN (
  SELECT id FROM picking_instructions WHERE shipping_instruction_id = ${fixture.shippingId}
);
DELETE FROM packing_records WHERE shipping_instruction_id = ${fixture.shippingId};
DELETE FROM picking_instructions WHERE shipping_instruction_id = ${fixture.shippingId};
DELETE FROM shipping_lot_allocations WHERE shipping_instruction_line_id IN (
  SELECT id FROM shipping_instruction_lines WHERE shipping_instruction_id = ${fixture.shippingId}
);
DELETE FROM shipping_instruction_lines WHERE shipping_instruction_id = ${fixture.shippingId};
DELETE FROM shipping_audit_events WHERE shipping_instruction_id = ${fixture.shippingId};
DELETE FROM shipping_instructions WHERE id = ${fixture.shippingId};
DELETE FROM lot_inventory WHERE lot_number IN ('${fixture.lotNumber}', '${fixture.lotNumber}-FIX');
`);
}

test('PPS OK scan can be undone before completion and records audit log', async () => {
  const auth = await get('/api/auth/m365/config');
  if (auth.status === 200 && auth.body.enabled && auth.body.required) {
    const protectedResponse = await send('DELETE', '/api/picking-instructions/1/records/1');
    assert.equal(protectedResponse.status, 401);
    return;
  }

  const fixture = await createFixture();
  try {
    const scanned = await send('POST', `/api/picking-instructions/${fixture.pickingId}/scan`, {
      lot_number: fixture.lotNumber,
      picked_quantity: 1
    });
    assert.equal(scanned.status, 200);
    assert.equal(scanned.body.success, true);
    assert.equal(scanned.body.picked_quantity, 1);
    assert.ok(scanned.body.record?.id, 'scan response should include record id');

    const undone = await send('DELETE', `/api/picking-instructions/${fixture.pickingId}/records/${scanned.body.record.id}`);
    assert.equal(undone.status, 200);
    assert.equal(undone.body.success, true);
    assert.equal(undone.body.picked_quantity, 0);
    assert.equal(undone.body.cancelled_record.id, scanned.body.record.id);

    const ppsStatus = await get(`/api/shipping-instructions/${fixture.shippingId}/pps-status`);
    assert.equal(ppsStatus.status, 200);
    assert.equal(Number(ppsStatus.body.picking.picked_quantity), 0);

    const history = await get(`/api/shipping-instructions/${fixture.shippingId}/history`);
    assert.equal(history.status, 200);
    assert.ok(
      history.body.audit_events.some((event) => event.event_type === 'qr_scan_cancelled'),
      'history should include qr_scan_cancelled audit event'
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test('PPS scan undo is rejected after shipping has moved past picking', async () => {
  const auth = await get('/api/auth/m365/config');
  if (auth.status === 200 && auth.body.enabled && auth.body.required) {
    const protectedResponse = await send('DELETE', '/api/picking-instructions/1/records/1');
    assert.equal(protectedResponse.status, 401);
    return;
  }

  const fixture = await createFixture();
  try {
    const scanned = await send('POST', `/api/picking-instructions/${fixture.pickingId}/scan`, {
      lot_number: fixture.lotNumber,
      picked_quantity: 1
    });
    assert.equal(scanned.status, 200);
    psql(`UPDATE shipping_instructions SET status = 'packing' WHERE id = ${fixture.shippingId};`);

    const rejected = await send('DELETE', `/api/picking-instructions/${fixture.pickingId}/records/${scanned.body.record.id}`);
    assert.equal(rejected.status, 409);
    assert.match(rejected.body.error, /ピッキング中のみ可能|完了後修正/);
  } finally {
    cleanupFixture(fixture);
  }
});

test('post-completion correction updates allocation and records audit log', async () => {
  const auth = await get('/api/auth/m365/config');
  if (auth.status === 200 && auth.body.enabled && auth.body.required) {
    const protectedResponse = await send('POST', '/api/shipping-instructions/1/post-completion-corrections', {});
    assert.equal(protectedResponse.status, 401);
    return;
  }

  const fixture = await createFixture();
  try {
    const correctedLot = `${fixture.lotNumber}-FIX`;
    psql(`
INSERT INTO lot_inventory (product_id, lot_number, quantity, location, status, notes)
SELECT product_id, '${correctedLot}', 20, 'TEST', 'available', 'contract test correction lot'
FROM lot_inventory
WHERE lot_number = '${fixture.lotNumber}'
LIMIT 1
ON CONFLICT (product_id, lot_number) DO UPDATE SET
  quantity = GREATEST(lot_inventory.quantity, EXCLUDED.quantity),
  location = EXCLUDED.location,
  status = 'available',
  updated_at = CURRENT_TIMESTAMP;
UPDATE shipping_instructions SET status = 'shipped' WHERE id = ${fixture.shippingId};
`);

    const corrected = await send('POST', `/api/shipping-instructions/${fixture.shippingId}/post-completion-corrections`, {
      allocation_id: fixture.allocationId,
      lot_number: correctedLot,
      shipped_quantity: 2,
      reason_code: 'lot_entry_error',
      comment: 'contract test post-completion correction'
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.success, true);
    assert.equal(corrected.body.allocation.lot_number, correctedLot);

    const history = await get(`/api/shipping-instructions/${fixture.shippingId}/history`);
    assert.equal(history.status, 200);
    assert.ok(
      history.body.audit_events.some((event) =>
        event.event_type === 'post_completion_corrected'
        && event.reason_code === 'lot_entry_error'
        && event.lot_number === correctedLot
      ),
      'history should include post_completion_corrected audit event'
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test('post-completion correction rejects a line quantity over-allocation without side effects', async () => {
  const auth = await get('/api/auth/m365/config');
  if (auth.status === 200 && auth.body.enabled && auth.body.required) {
    const protectedResponse = await send('POST', '/api/shipping-instructions/1/post-completion-corrections', {});
    assert.equal(protectedResponse.status, 401);
    return;
  }

  const fixture = await createFixture();
  try {
    psql(`UPDATE shipping_instructions SET status = 'shipped' WHERE id = ${fixture.shippingId};`);
    const beforeLotQuantity = Number(psql(`SELECT quantity FROM lot_inventory WHERE lot_number = '${fixture.lotNumber}';`));

    const rejected = await send('POST', `/api/shipping-instructions/${fixture.shippingId}/post-completion-corrections`, {
      allocation_id: fixture.allocationId,
      shipped_quantity: 3,
      reason_code: 'quantity_entry_error',
      comment: 'contract test must reject line quantity overflow'
    });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.code, 'SHIPPING_LINE_QUANTITY_EXCEEDED');

    const persisted = psql(`
SELECT a.shipped_quantity || ',' || li.quantity || ',' || COUNT(e.id)
FROM shipping_lot_allocations a
JOIN lot_inventory li ON li.id = a.lot_inventory_id
LEFT JOIN shipping_audit_events e
  ON e.allocation_id = a.id AND e.event_type = 'post_completion_corrected'
WHERE a.id = ${fixture.allocationId}
GROUP BY a.shipped_quantity, li.quantity;
`);
    assert.equal(persisted, `2,${beforeLotQuantity},0`);
  } finally {
    cleanupFixture(fixture);
  }
});

test('post-completion correction rejects a cancelled allocation without side effects', async () => {
  const auth = await get('/api/auth/m365/config');
  if (auth.status === 200 && auth.body.enabled && auth.body.required) {
    const protectedResponse = await send('POST', '/api/shipping-instructions/1/post-completion-corrections', {});
    assert.equal(protectedResponse.status, 401);
    return;
  }

  const fixture = await createFixture();
  try {
    psql(`
UPDATE shipping_instructions SET status = 'shipped' WHERE id = ${fixture.shippingId};
UPDATE shipping_lot_allocations SET status = 'cancelled' WHERE id = ${fixture.allocationId};
`);
    const beforeLotQuantity = Number(psql(`SELECT quantity FROM lot_inventory WHERE lot_number = '${fixture.lotNumber}';`));

    const rejected = await send('POST', `/api/shipping-instructions/${fixture.shippingId}/post-completion-corrections`, {
      allocation_id: fixture.allocationId,
      shipped_quantity: 1,
      reason_code: 'quantity_entry_error',
      comment: 'cancelled allocation must not be corrected'
    });
    assert.equal(rejected.status, 404);

    const persisted = psql(`
SELECT a.shipped_quantity || ',' || li.quantity || ',' || COUNT(e.id)
FROM shipping_lot_allocations a
JOIN lot_inventory li ON li.id = a.lot_inventory_id
LEFT JOIN shipping_audit_events e
  ON e.allocation_id = a.id AND e.event_type = 'post_completion_corrected'
WHERE a.id = ${fixture.allocationId}
GROUP BY a.shipped_quantity, li.quantity;
`);
    assert.equal(persisted, `2,${beforeLotQuantity},0`);
  } finally {
    cleanupFixture(fixture);
  }
});
