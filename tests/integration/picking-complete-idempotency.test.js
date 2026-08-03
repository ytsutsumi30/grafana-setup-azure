const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromApi = createRequire(path.resolve(__dirname, '../../api/package.json'));
const { Client } = requireFromApi('pg');

test('completing a picking instruction twice deducts inventory once', async () => {
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

        const locationCode = `PICK-${suffix}`;
        const location = await client.query(`
            INSERT INTO locations (location_code, location_name, location_type)
            VALUES ($1, $1, 'warehouse') RETURNING id
        `, [locationCode]);
        fixture.locationId = location.rows[0].id;

        const lot = await client.query(`
            INSERT INTO lot_inventory
              (product_id, lot_number, quantity, location, location_id, status, inventory_status)
            VALUES ($1, $2, 10, $3, $4, 'available', 'available') RETURNING id
        `, [fixture.productId, `PICK-LOT-${suffix}`, locationCode, fixture.locationId]);
        fixture.lotId = lot.rows[0].id;
        fixture.lotNumber = `PICK-LOT-${suffix}`;

        const shipping = await client.query(`
            INSERT INTO shipping_instructions
              (instruction_id, product_id, quantity, status, customer_name)
            VALUES ($1, $2, 2, 'picking', 'integration-test') RETURNING id
        `, [`PICK-SHIP-${suffix}`, fixture.productId]);
        fixture.shippingId = shipping.rows[0].id;

        const picking = await client.query(`
            INSERT INTO picking_instructions
              (picking_id, shipping_instruction_id, picker_name, total_quantity, picked_quantity, status)
            VALUES ($1, $2, 'integration-test', 2, 2, 'in_progress') RETURNING id
        `, [`PICK-${suffix}`, fixture.shippingId]);
        fixture.pickingId = picking.rows[0].id;

        await client.query(`
            INSERT INTO picking_records
              (picking_instruction_id, lot_inventory_id, lot_number, product_id, picked_quantity, status)
            VALUES ($1, $2, $3, $4, 2, 'picked')
        `, [fixture.pickingId, fixture.lotId, fixture.lotNumber, fixture.productId]);

        const firstResponse = await fetch(`${baseUrl}/api/picking-instructions/${fixture.pickingId}/complete`, {
            method: 'PATCH'
        });
        assert.equal(firstResponse.status, 200);
        const first = await firstResponse.json();
        assert.equal(first.idempotent, false);

        const secondResponse = await fetch(`${baseUrl}/api/picking-instructions/${fixture.pickingId}/complete`, {
            method: 'PATCH'
        });
        assert.equal(secondResponse.status, 200);
        const second = await secondResponse.json();
        assert.equal(second.idempotent, true);

        const result = await client.query(`
            SELECT li.quantity,
                   (SELECT COUNT(*)::int FROM inventory_transactions
                    WHERE source_type = 'picking_instruction_legacy' AND source_id = $2) AS movement_count,
                   (SELECT COUNT(*)::int FROM shipping_audit_events
                    WHERE shipping_instruction_id = $3 AND event_type = 'picking_completed') AS audit_count
            FROM lot_inventory li
            WHERE li.id = $1
        `, [fixture.lotId, fixture.pickingId, fixture.shippingId]);
        assert.deepEqual(result.rows, [{ quantity: 8, movement_count: 1, audit_count: 1 }]);

        await client.query("UPDATE picking_instructions SET status = 'cancelled' WHERE id = $1", [fixture.pickingId]);
        const cancelledResponse = await fetch(`${baseUrl}/api/picking-instructions/${fixture.pickingId}/complete`, {
            method: 'PATCH'
        });
        assert.equal(cancelledResponse.status, 409);
        const cancelled = await cancelledResponse.json();
        assert.equal(cancelled.code, 'INVALID_PICKING_COMPLETION_STATE');

        const afterCancelledAttempt = await client.query(`
            SELECT quantity,
                   (SELECT COUNT(*)::int FROM inventory_transactions
                    WHERE source_type = 'picking_instruction_legacy' AND source_id = $2) AS movement_count
            FROM lot_inventory WHERE id = $1
        `, [fixture.lotId, fixture.pickingId]);
        assert.deepEqual(afterCancelledAttempt.rows, [{ quantity: 8, movement_count: 1 }]);

        await client.query("UPDATE picking_instructions SET status = 'in_progress', picked_quantity = 3 WHERE id = $1", [fixture.pickingId]);
        await client.query("UPDATE shipping_instructions SET status = 'picking' WHERE id = $1", [fixture.shippingId]);
        const overPickedResponse = await fetch(`${baseUrl}/api/picking-instructions/${fixture.pickingId}/complete`, {
            method: 'PATCH'
        });
        assert.equal(overPickedResponse.status, 409);
        assert.match((await overPickedResponse.json()).error, /指示数量と一致しません/);
    } finally {
        if (fixture.pickingId) {
            await client.query('DELETE FROM inventory_balances WHERE lot_inventory_id = $1', [fixture.lotId]);
            await client.query("DELETE FROM inventory_transactions WHERE source_type = 'picking_instruction_legacy' AND source_id = $1", [fixture.pickingId]);
            await client.query('DELETE FROM shipping_audit_events WHERE shipping_instruction_id = $1', [fixture.shippingId]);
            await client.query('DELETE FROM picking_records WHERE picking_instruction_id = $1', [fixture.pickingId]);
            await client.query('DELETE FROM picking_instructions WHERE id = $1', [fixture.pickingId]);
            await client.query('DELETE FROM shipping_instructions WHERE id = $1', [fixture.shippingId]);
            await client.query('DELETE FROM lot_inventory WHERE id = $1', [fixture.lotId]);
            await client.query('DELETE FROM locations WHERE id = $1', [fixture.locationId]);
        }
        await client.end();
    }
});
