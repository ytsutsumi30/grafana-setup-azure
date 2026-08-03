const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromApi = createRequire(path.resolve(__dirname, '../../api/package.json'));
const { Client } = requireFromApi('pg');

test('receiving rejects a QR code already assigned to another lot', async () => {
    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5433),
        database: process.env.DB_NAME || 'production_db',
        user: process.env.DB_USER || 'production_user',
        password: process.env.DB_PASSWORD || 'production_pass'
    });
    const baseUrl = process.env.BASE || 'http://127.0.0.1:8080';
    const suffix = `${process.pid}-${Date.now()}`;
    const fixture = {};

    await client.connect();
    try {
        const product = await client.query('SELECT id FROM products ORDER BY id LIMIT 1');
        assert.equal(product.rows.length, 1, 'test database requires at least one product');
        fixture.productId = product.rows[0].id;
        fixture.oldLotNumber = `QR-OLD-${suffix}`;
        fixture.newLotNumber = `QR-NEW-${suffix}`;
        fixture.qrCode = `QR-CONFLICT-${suffix}`;

        const oldLot = await client.query(`
            INSERT INTO lot_inventory (product_id, lot_number, quantity, status, inventory_status)
            VALUES ($1, $2, 0, 'available', 'available') RETURNING id
        `, [fixture.productId, fixture.oldLotNumber]);
        fixture.oldLotId = oldLot.rows[0].id;
        const qr = await client.query(`
            INSERT INTO qr_units
              (qr_code, product_id, lot_inventory_id, lot_number, quantity, current_quantity, status)
            VALUES ($1, $2, $3, $4, 1, 1, 'available') RETURNING id
        `, [fixture.qrCode, fixture.productId, fixture.oldLotId, fixture.oldLotNumber]);
        fixture.qrId = qr.rows[0].id;

        const order = await client.query(`
            INSERT INTO receiving_orders (receiving_order_no, status)
            VALUES ($1, 'pending') RETURNING id
        `, [`QR-RCV-${suffix}`]);
        fixture.orderId = order.rows[0].id;
        const line = await client.query(`
            INSERT INTO receiving_order_lines
              (receiving_order_id, product_id, expected_quantity, status)
            VALUES ($1, $2, 5, 'pending') RETURNING id
        `, [fixture.orderId, fixture.productId]);
        fixture.lineId = line.rows[0].id;

        const response = await fetch(`${baseUrl}/api/receiving-orders/${fixture.orderId}/scan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                receiving_order_line_id: fixture.lineId,
                qr_code: fixture.qrCode,
                lot_number: fixture.newLotNumber,
                received_quantity: 1,
                accepted_quantity: 1,
                rejected_quantity: 0,
                inspection_status: 'accepted',
                location_code: `QR-LOC-${suffix}`
            })
        });
        assert.equal(response.status, 409);
        const body = await response.json();
        assert.equal(body.code, 'QR_IDENTITY_CONFLICT');

        const persisted = await client.query(`
            SELECT qu.lot_number,
                   (SELECT COUNT(*)::int FROM receiving_results WHERE receiving_order_id = $2) AS result_count,
                   (SELECT received_quantity FROM receiving_order_lines WHERE id = $3) AS received_quantity,
                   (SELECT COUNT(*)::int FROM lot_inventory WHERE product_id = $4 AND lot_number = $5) AS new_lot_count
            FROM qr_units qu
            WHERE qu.id = $1
        `, [fixture.qrId, fixture.orderId, fixture.lineId, fixture.productId, fixture.newLotNumber]);
        assert.deepEqual(persisted.rows, [{
            lot_number: fixture.oldLotNumber,
            result_count: 0,
            received_quantity: 0,
            new_lot_count: 0
        }]);
    } finally {
        if (fixture.lineId) await client.query('DELETE FROM receiving_order_lines WHERE id = $1', [fixture.lineId]);
        if (fixture.orderId) await client.query('DELETE FROM receiving_orders WHERE id = $1', [fixture.orderId]);
        if (fixture.qrId) await client.query('DELETE FROM qr_units WHERE id = $1', [fixture.qrId]);
        if (fixture.oldLotId) await client.query('DELETE FROM lot_inventory WHERE id = $1', [fixture.oldLotId]);
        await client.query('DELETE FROM locations WHERE location_code = $1', [`QR-LOC-${suffix}`]);
        await client.end();
    }
});

test('receiving returns the first result when the same idempotency key is retried', async () => {
    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5433),
        database: process.env.DB_NAME || 'production_db',
        user: process.env.DB_USER || 'production_user',
        password: process.env.DB_PASSWORD || 'production_pass'
    });
    const baseUrl = process.env.BASE || 'http://127.0.0.1:8080';
    const suffix = `${process.pid}-${Date.now()}`;
    const fixture = {};

    await client.connect();
    try {
        const product = await client.query('SELECT id FROM products ORDER BY id LIMIT 1');
        fixture.productId = product.rows[0].id;
        fixture.lotNumber = `QR-IDEMPOTENT-${suffix}`;
        fixture.qrCode = `QR-IDEMPOTENT-${suffix}`;
        fixture.locationCode = `QR-IDEMPOTENT-${suffix}`;
        fixture.idempotencyKey = `receiving-${suffix}`;

        const order = await client.query(`
            INSERT INTO receiving_orders (receiving_order_no, status)
            VALUES ($1, 'pending') RETURNING id
        `, [`IDEMPOTENT-RCV-${suffix}`]);
        fixture.orderId = order.rows[0].id;
        const line = await client.query(`
            INSERT INTO receiving_order_lines
              (receiving_order_id, product_id, expected_quantity, status)
            VALUES ($1, $2, 5, 'pending') RETURNING id
        `, [fixture.orderId, fixture.productId]);
        fixture.lineId = line.rows[0].id;

        const payload = {
            receiving_order_line_id: fixture.lineId,
            qr_code: fixture.qrCode,
            lot_number: fixture.lotNumber,
            received_quantity: 1,
            accepted_quantity: 1,
            rejected_quantity: 0,
            inspection_status: 'accepted',
            location_code: fixture.locationCode
        };
        const mixedResponse = await fetch(`${baseUrl}/api/receiving-orders/${fixture.orderId}/scan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                ...payload,
                qr_code: `${fixture.qrCode}-MIXED`,
                received_quantity: 2,
                accepted_quantity: 1,
                rejected_quantity: 1
            })
        });
        assert.equal(mixedResponse.status, 400);
        assert.equal((await mixedResponse.json()).code, 'QR_MIXED_INVENTORY_STATUS');

        const send = () => fetch(`${baseUrl}/api/receiving-orders/${fixture.orderId}/scan`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'idempotency-key': fixture.idempotencyKey
            },
            body: JSON.stringify(payload)
        });

        const firstResponse = await send();
        assert.equal(firstResponse.status, 201);
        const first = await firstResponse.json();
        assert.equal(first.idempotent, false);
        fixture.resultId = first.receiving_result.id;
        fixture.lotId = first.receiving_result.lot_inventory_id;
        fixture.qrId = first.receiving_result.qr_unit_id;

        const secondResponse = await send();
        assert.equal(secondResponse.status, 200);
        const second = await secondResponse.json();
        assert.equal(second.idempotent, true);
        assert.equal(second.receiving_result.id, fixture.resultId);

        const changedPayloadResponse = await fetch(`${baseUrl}/api/receiving-orders/${fixture.orderId}/scan`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'idempotency-key': fixture.idempotencyKey
            },
            body: JSON.stringify({ ...payload, comment: 'different retry payload' })
        });
        assert.equal(changedPayloadResponse.status, 409);
        assert.equal((await changedPayloadResponse.json()).code, 'IDEMPOTENCY_KEY_REUSED');

        const persisted = await client.query(`
            SELECT rol.received_quantity,
                   (SELECT COUNT(*)::int FROM receiving_results
                    WHERE receiving_order_id = $1 AND idempotency_key = $2) AS result_count,
                   (SELECT quantity FROM lot_inventory WHERE id = $3) AS lot_quantity,
                   (SELECT COUNT(*)::int FROM inventory_transactions
                    WHERE source_type = 'receiving_result' AND source_id = $4) AS movement_count
            FROM receiving_order_lines rol
            WHERE rol.id = $5
        `, [fixture.orderId, fixture.idempotencyKey, fixture.lotId, fixture.resultId, fixture.lineId]);
        assert.deepEqual(persisted.rows, [{
            received_quantity: 1,
            result_count: 1,
            lot_quantity: 1,
            movement_count: 1
        }]);
    } finally {
        if (fixture.resultId) {
            await client.query('DELETE FROM operation_events WHERE source_type = $1 AND source_id = $2', ['receiving_order', fixture.orderId]);
            await client.query('DELETE FROM inventory_balances WHERE lot_inventory_id = $1', [fixture.lotId]);
            await client.query("DELETE FROM inventory_transactions WHERE source_type = 'receiving_result' AND source_id = $1", [fixture.resultId]);
            await client.query('DELETE FROM receiving_results WHERE id = $1', [fixture.resultId]);
            await client.query('DELETE FROM qr_units WHERE id = $1', [fixture.qrId]);
            await client.query('DELETE FROM lot_inventory WHERE id = $1', [fixture.lotId]);
            await client.query('DELETE FROM locations WHERE location_code = $1', [fixture.locationCode]);
        }
        if (fixture.lineId) await client.query('DELETE FROM receiving_order_lines WHERE id = $1', [fixture.lineId]);
        if (fixture.orderId) await client.query('DELETE FROM receiving_orders WHERE id = $1', [fixture.orderId]);
        await client.end();
    }
});
