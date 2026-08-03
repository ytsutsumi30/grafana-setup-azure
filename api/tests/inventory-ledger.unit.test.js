const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appendTransaction, InventoryLedgerError } = require('../lib/inventory-ledger');

class FakeClient {
    constructor({ balanceQuantity = null, ledgerQuantity = 0, lotQuantity = 0 } = {}) {
        this.balance = balanceQuantity === null ? [] : [{ id: 1, quantity: balanceQuantity, last_transaction_id: 10 }];
        this.ledgerQuantity = ledgerQuantity;
        this.lotQuantity = lotQuantity;
        this.transactions = [];
        this.nextId = 100;
    }

    async query(sql, params = []) {
        if (sql.includes('SELECT id, quantity, last_transaction_id')) {
            return { rows: this.balance.map((row) => ({ ...row })) };
        }
        if (sql.includes('SELECT COALESCE(SUM(quantity_delta)')) {
            return { rows: [{ quantity: this.ledgerQuantity }] };
        }
        if (sql.includes("VALUES ('inventory_reconciliation'")) {
            const transaction = {
                id: this.nextId++,
                transaction_type: 'inventory_reconciliation',
                inventory_status: params[0],
                qr_unit_id: params[3],
                quantity_delta: params[7],
                quantity_after: params[8]
            };
            this.transactions.push(transaction);
            this.ledgerQuantity += transaction.quantity_delta;
            return { rows: [] };
        }
        if (sql.includes('INSERT INTO inventory_transactions')) {
            const transaction = {
                id: this.nextId++,
                transaction_type: params[0],
                inventory_status: params[1],
                quantity_delta: params[8],
                quantity_after: params[9]
            };
            this.transactions.push(transaction);
            this.ledgerQuantity += transaction.quantity_delta;
            return { rows: [transaction] };
        }
        if (sql.includes('DELETE FROM inventory_balances')) {
            this.balance = [];
            return { rows: [] };
        }
        if (sql.includes('INSERT INTO inventory_balances')) {
            this.balance = [{
                id: 2,
                product_id: params[0],
                qr_unit_id: params[2],
                inventory_status: params[6],
                quantity: params[7],
                last_transaction_id: params[8]
            }];
            return { rows: [{ ...this.balance[0] }] };
        }
        if (sql.includes('UPDATE inventory_balances')) {
            return { rows: [] };
        }
        if (sql.includes('UPDATE lot_inventory')) {
            this.lotQuantity += params[0];
            return { rows: [{ id: params[3], quantity: this.lotQuantity }] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    }
}

function baseFields(overrides = {}) {
    return {
        transaction_type: 'receiving',
        inventory_status: 'available',
        product_id: 1,
        lot_inventory_id: 10,
        lot_number: 'LOT-1',
        location_id: 20,
        location_code: 'A-1-01',
        quantity_delta: 3,
        opening_quantity: 5,
        trust_opening_quantity: true,
        sync_lot_inventory: true,
        source_type: 'test',
        source_id: 30,
        ...overrides
    };
}

test('receipt appends a transaction and synchronizes balance and lot projection', async () => {
    const client = new FakeClient({ balanceQuantity: 5, ledgerQuantity: 5, lotQuantity: 5 });
    const result = await appendTransaction(client, baseFields());

    assert.equal(result.previous_quantity, 5);
    assert.equal(result.quantity_after, 8);
    assert.equal(client.balance[0].quantity, 8);
    assert.equal(client.lotQuantity, 8);
    assert.deepEqual(client.transactions.map((row) => row.transaction_type), ['receiving']);
});

test('legacy lot is reconciled before the first shipping movement', async () => {
    const client = new FakeClient({ balanceQuantity: null, ledgerQuantity: 0, lotQuantity: 20 });
    const result = await appendTransaction(client, baseFields({
        transaction_type: 'shipping_allocation',
        quantity_delta: -5,
        opening_quantity: 20
    }));

    assert.equal(result.quantity_after, 15);
    assert.equal(client.balance[0].quantity, 15);
    assert.equal(client.lotQuantity, 15);
    assert.deepEqual(
        client.transactions.map((row) => [row.transaction_type, row.quantity_delta]),
        [['inventory_reconciliation', 20], ['shipping_allocation', -5]]
    );
});

test('hold movement is recorded separately and does not change available lot quantity', async () => {
    const client = new FakeClient({ balanceQuantity: null, ledgerQuantity: 0, lotQuantity: 7 });
    const result = await appendTransaction(client, baseFields({
        transaction_type: 'hold',
        inventory_status: 'on_hold',
        quantity_delta: 2,
        opening_quantity: 0,
        trust_opening_quantity: false,
        sync_lot_inventory: false
    }));

    assert.equal(result.quantity_after, 2);
    assert.equal(client.balance[0].inventory_status, 'on_hold');
    assert.equal(client.lotQuantity, 7);
});

test('QR balances remain separated while the lot projection receives each delta', async () => {
    const firstQrClient = new FakeClient({ balanceQuantity: null, ledgerQuantity: 0, lotQuantity: 0 });
    const first = await appendTransaction(firstQrClient, baseFields({
        qr_unit_id: 101,
        quantity_delta: 2,
        opening_quantity: 0
    }));
    assert.equal(first.balance.qr_unit_id, 101);
    assert.equal(first.quantity_after, 2);
    assert.equal(firstQrClient.lotQuantity, 2);

    const secondQrClient = new FakeClient({ balanceQuantity: null, ledgerQuantity: 0, lotQuantity: 2 });
    const second = await appendTransaction(secondQrClient, baseFields({
        qr_unit_id: 102,
        quantity_delta: 3,
        opening_quantity: 0
    }));
    assert.equal(second.balance.qr_unit_id, 102);
    assert.equal(second.quantity_after, 3);
    assert.equal(secondQrClient.lotQuantity, 5);
});

test('QR reconciliation preserves the QR unit key', async () => {
    const client = new FakeClient({ balanceQuantity: 5, ledgerQuantity: 0, lotQuantity: 5 });
    await appendTransaction(client, baseFields({
        qr_unit_id: 101,
        quantity_delta: -1,
        opening_quantity: 5
    }));

    assert.equal(client.transactions[0].transaction_type, 'inventory_reconciliation');
    assert.equal(client.transactions[0].qr_unit_id, 101);
    assert.equal(client.transactions[0].quantity_delta, 5);
});

test('movement that would make inventory negative is rejected', async () => {
    const client = new FakeClient({ balanceQuantity: 4, ledgerQuantity: 4, lotQuantity: 4 });

    await assert.rejects(
        appendTransaction(client, baseFields({ quantity_delta: -5, opening_quantity: 4 })),
        (error) => error instanceof InventoryLedgerError
            && error.code === 'INSUFFICIENT_INVENTORY'
            && error.status === 409
    );
    assert.equal(client.transactions.length, 0);
    assert.equal(client.balance[0].quantity, 4);
    assert.equal(client.lotQuantity, 4);
});

test('zero quantity movement is rejected before touching the database', async () => {
    const client = new FakeClient();
    await assert.rejects(
        appendTransaction(client, baseFields({ quantity_delta: 0 })),
        (error) => error instanceof InventoryLedgerError && error.code === 'ZERO_INVENTORY_MOVEMENT'
    );
    assert.equal(client.transactions.length, 0);
});
