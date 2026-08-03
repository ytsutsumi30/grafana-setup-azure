const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromApi = createRequire(path.resolve(__dirname, '../../api/package.json'));
const { Client } = requireFromApi('pg');
const { appendTransaction } = require('../../api/lib/inventory-ledger');

test('real database applies a receipt to ledger, balance, and lot atomically', async () => {
    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5433),
        database: process.env.DB_NAME || 'production_db',
        user: process.env.DB_USER || 'production_user',
        password: process.env.DB_PASSWORD || 'production_pass'
    });

    await client.connect();
    await client.query('BEGIN');
    try {
        const product = await client.query('SELECT id FROM products ORDER BY id LIMIT 1');
        assert.equal(product.rows.length, 1, 'test database requires at least one product');

        const suffix = `${process.pid}-${Date.now()}`;
        const locationCode = `TEST-${suffix}`;
        const lotNumber = `TEST-LOT-${suffix}`;
        const location = await client.query(`
            INSERT INTO locations (location_code, location_name, location_type)
            VALUES ($1, $1, 'warehouse')
            RETURNING id
        `, [locationCode]);
        const lot = await client.query(`
            INSERT INTO lot_inventory
              (product_id, lot_number, quantity, location, location_id, status, inventory_status)
            VALUES ($1, $2, 0, $3, $4, 'available', 'available')
            RETURNING id
        `, [product.rows[0].id, lotNumber, locationCode, location.rows[0].id]);

        const movement = await appendTransaction(client, {
            transaction_type: 'receiving',
            inventory_status: 'available',
            product_id: product.rows[0].id,
            lot_inventory_id: lot.rows[0].id,
            lot_number: lotNumber,
            location_id: location.rows[0].id,
            location_code: locationCode,
            quantity_delta: 5,
            opening_quantity: 0,
            trust_opening_quantity: true,
            sync_lot_inventory: true,
            source_type: 'integration_test',
            source_id: 1,
            created_by: 'inventory-ledger-integration-test'
        });

        assert.equal(movement.quantity_after, 5);
        assert.equal(movement.transaction.inventory_status, 'available');

        const projection = await client.query(`
            SELECT li.quantity AS lot_quantity, ib.quantity AS balance_quantity,
                   ib.last_transaction_id, it.inventory_status
            FROM lot_inventory li
            JOIN inventory_balances ib ON ib.lot_inventory_id = li.id
            JOIN inventory_transactions it ON it.id = ib.last_transaction_id
            WHERE li.id = $1
        `, [lot.rows[0].id]);
        assert.deepEqual(projection.rows, [{
            lot_quantity: 5,
            balance_quantity: 5,
            last_transaction_id: movement.transaction.id,
            inventory_status: 'available'
        }]);
    } finally {
        await client.query('ROLLBACK');
        await client.end();
    }
});

test('real database keeps two QR balances for one lot without losing lot total', async () => {
    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5433),
        database: process.env.DB_NAME || 'production_db',
        user: process.env.DB_USER || 'production_user',
        password: process.env.DB_PASSWORD || 'production_pass'
    });

    await client.connect();
    await client.query('BEGIN');
    try {
        const product = await client.query('SELECT id FROM products ORDER BY id LIMIT 1');
        assert.equal(product.rows.length, 1, 'test database requires at least one product');

        const suffix = `${process.pid}-${Date.now()}`;
        const locationCode = `QR-TEST-${suffix}`;
        const lotNumber = `QR-LOT-${suffix}`;
        const location = await client.query(`
            INSERT INTO locations (location_code, location_name, location_type)
            VALUES ($1, $1, 'warehouse') RETURNING id
        `, [locationCode]);
        const lot = await client.query(`
            INSERT INTO lot_inventory
              (product_id, lot_number, quantity, location, location_id, status, inventory_status)
            VALUES ($1, $2, 0, $3, $4, 'available', 'available') RETURNING id
        `, [product.rows[0].id, lotNumber, locationCode, location.rows[0].id]);
        const qrOne = await client.query(`
            INSERT INTO qr_units
              (qr_code, product_id, lot_inventory_id, lot_number, quantity, current_quantity, status, location, location_id)
            VALUES ($1, $2, $3, $4, 2, 2, 'available', $5, $6) RETURNING id
        `, [`QR-ONE-${suffix}`, product.rows[0].id, lot.rows[0].id, lotNumber, locationCode, location.rows[0].id]);
        const qrTwo = await client.query(`
            INSERT INTO qr_units
              (qr_code, product_id, lot_inventory_id, lot_number, quantity, current_quantity, status, location, location_id)
            VALUES ($1, $2, $3, $4, 3, 3, 'available', $5, $6) RETURNING id
        `, [`QR-TWO-${suffix}`, product.rows[0].id, lot.rows[0].id, lotNumber, locationCode, location.rows[0].id]);

        for (const [qrUnitId, quantity] of [[qrOne.rows[0].id, 2], [qrTwo.rows[0].id, 3]]) {
            await appendTransaction(client, {
                transaction_type: 'receiving',
                inventory_status: 'available',
                product_id: product.rows[0].id,
                lot_inventory_id: lot.rows[0].id,
                qr_unit_id: qrUnitId,
                lot_number: lotNumber,
                location_id: location.rows[0].id,
                location_code: locationCode,
                quantity_delta: quantity,
                opening_quantity: 0,
                sync_lot_inventory: true,
                source_type: 'integration_test_qr',
                source_id: qrUnitId,
                created_by: 'inventory-ledger-integration-test'
            });
        }

        const balances = await client.query(`
            SELECT qr_unit_id, quantity
            FROM inventory_balances
            WHERE lot_inventory_id = $1
            ORDER BY qr_unit_id
        `, [lot.rows[0].id]);
        assert.deepEqual(balances.rows, [
            { qr_unit_id: qrOne.rows[0].id, quantity: 2 },
            { qr_unit_id: qrTwo.rows[0].id, quantity: 3 }
        ]);

        const lotProjection = await client.query('SELECT quantity FROM lot_inventory WHERE id = $1', [lot.rows[0].id]);
        assert.equal(lotProjection.rows[0].quantity, 5);

        await appendTransaction(client, {
            transaction_type: 'shipping_allocation',
            inventory_status: 'available',
            product_id: product.rows[0].id,
            lot_inventory_id: lot.rows[0].id,
            lot_number: lotNumber,
            location_id: location.rows[0].id,
            location_code: locationCode,
            quantity_delta: -2,
            opening_quantity: 5,
            sync_lot_inventory: true,
            source_type: 'integration_test_lot_projection',
            source_id: 1,
            created_by: 'inventory-ledger-integration-test'
        });

        const visibleProjection = await client.query(`
            SELECT ib.qr_unit_id, ib.quantity
            FROM inventory_balances ib
            WHERE ib.lot_inventory_id = $1
              AND NOT (
                  ib.qr_unit_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM inventory_balances aggregate_balance
                      WHERE aggregate_balance.product_id = ib.product_id
                        AND COALESCE(aggregate_balance.lot_number, '') = COALESCE(ib.lot_number, '')
                        AND COALESCE(aggregate_balance.location_code, '') = COALESCE(ib.location_code, '')
                        AND aggregate_balance.inventory_status = ib.inventory_status
                        AND aggregate_balance.qr_unit_id IS NULL
                  )
              )
        `, [lot.rows[0].id]);
        assert.deepEqual(visibleProjection.rows, [{ qr_unit_id: null, quantity: 3 }]);

        const qrThree = await client.query(`
            INSERT INTO qr_units
              (qr_code, product_id, lot_inventory_id, lot_number, quantity, current_quantity, status, location, location_id)
            VALUES ($1, $2, $3, $4, 4, 4, 'available', $5, $6) RETURNING id
        `, [`QR-THREE-${suffix}`, product.rows[0].id, lot.rows[0].id, lotNumber, locationCode, location.rows[0].id]);
        await appendTransaction(client, {
            transaction_type: 'receiving',
            inventory_status: 'available',
            product_id: product.rows[0].id,
            lot_inventory_id: lot.rows[0].id,
            qr_unit_id: qrThree.rows[0].id,
            lot_number: lotNumber,
            location_id: location.rows[0].id,
            location_code: locationCode,
            quantity_delta: 4,
            opening_quantity: 0,
            sync_lot_inventory: true,
            source_type: 'integration_test_qr_restock',
            source_id: qrThree.rows[0].id,
            created_by: 'inventory-ledger-integration-test'
        });
        const restockedProjection = await client.query(`
            SELECT quantity FROM inventory_balances
            WHERE lot_inventory_id = $1 AND qr_unit_id IS NULL AND inventory_status = 'available'
        `, [lot.rows[0].id]);
        assert.deepEqual(restockedProjection.rows, [{ quantity: 7 }]);
    } finally {
        await client.query('ROLLBACK');
        await client.end();
    }
});
