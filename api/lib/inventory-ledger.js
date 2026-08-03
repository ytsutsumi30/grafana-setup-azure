class InventoryLedgerError extends Error {
    constructor(message, code, status = 409) {
        super(message);
        this.name = 'InventoryLedgerError';
        this.code = code;
        this.status = status;
    }
}

function toInteger(value, fieldName) {
    const number = Number(value);
    if (!Number.isInteger(number)) {
        throw new InventoryLedgerError(`${fieldName} must be an integer`, 'INVALID_INVENTORY_MOVEMENT', 400);
    }
    return number;
}

async function appendTransaction(client, fields) {
    const quantityDelta = toInteger(fields.quantity_delta, 'quantity_delta');
    if (quantityDelta === 0) {
        throw new InventoryLedgerError('quantity_delta must not be zero', 'ZERO_INVENTORY_MOVEMENT', 400);
    }

    const inventoryStatus = fields.inventory_status || 'available';
    const locationCode = fields.location_code || null;
    const openingQuantity = toInteger(fields.opening_quantity || 0, 'opening_quantity');

    const balanceRows = await client.query(`
        SELECT id, quantity, last_transaction_id
        FROM inventory_balances
        WHERE product_id = $1
          AND COALESCE(lot_number, '') = COALESCE($2, '')
          AND COALESCE(location_code, '') = COALESCE($3, '')
          AND COALESCE(qr_unit_id, 0) = COALESCE($4::int, 0)
          AND inventory_status = $5
        FOR UPDATE
    `, [fields.product_id, fields.lot_number || null, locationCode,
        fields.qr_unit_id || null, inventoryStatus]);

    const projectedQuantity = balanceRows.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const currentQuantity = balanceRows.rows.length ? projectedQuantity : openingQuantity;

    const ledgerQuantityResult = await client.query(`
        SELECT COALESCE(SUM(quantity_delta), 0)::int AS quantity
        FROM inventory_transactions
        WHERE transaction_status = 'posted'
          AND product_id = $1
          AND COALESCE(lot_number, '') = COALESCE($2, '')
          AND COALESCE(location_code, '') = COALESCE($3, '')
          AND COALESCE(qr_unit_id, 0) = COALESCE($4::int, 0)
          AND inventory_status = $5
    `, [fields.product_id, fields.lot_number || null, locationCode,
        fields.qr_unit_id || null, inventoryStatus]);
    const ledgerQuantity = Number(ledgerQuantityResult.rows[0]?.quantity || 0);

    if (ledgerQuantity !== currentQuantity) {
        await client.query(`
            INSERT INTO inventory_transactions
              (transaction_type, transaction_status, inventory_status, product_id, lot_inventory_id,
               qr_unit_id, lot_number, location_id, location_code, quantity_delta, quantity_after,
               source_type, source_id, reason_code, comment, created_by)
            VALUES ('inventory_reconciliation','posted',$1,$2,$3,$4,$5,$6,$7,$8,$9,
                    'lot_inventory',$3,'ledger_projection_reconciliation',$10,$11)
        `, [inventoryStatus, fields.product_id, fields.lot_inventory_id || null,
            fields.qr_unit_id || null, fields.lot_number || null, fields.location_id || null, locationCode,
            currentQuantity - ledgerQuantity, currentQuantity,
            '既存在庫を追記型台帳へ整合', fields.created_by || 'inventory-ledger']);
    }

    const nextQuantity = currentQuantity + quantityDelta;
    if (nextQuantity < 0) {
        throw new InventoryLedgerError(
            `在庫残高(${currentQuantity})が不足しています`,
            'INSUFFICIENT_INVENTORY',
            409
        );
    }

    const transaction = await client.query(`
        INSERT INTO inventory_transactions
          (transaction_type, transaction_status, inventory_status, product_id, lot_inventory_id,
           qr_unit_id, lot_number, location_id, location_code, quantity_delta, quantity_after,
           source_type, source_id, source_line_id, reason_code, comment, created_by)
        VALUES ($1,'posted',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING *
    `, [fields.transaction_type, inventoryStatus, fields.product_id, fields.lot_inventory_id || null,
        fields.qr_unit_id || null, fields.lot_number || null, fields.location_id || null, locationCode,
        quantityDelta, nextQuantity, fields.source_type || null, fields.source_id || null,
        fields.source_line_id || null, fields.reason_code || null, fields.comment || null,
        fields.created_by || 'inventory-ledger']);

    if (balanceRows.rows.length) {
        await client.query('DELETE FROM inventory_balances WHERE id = ANY($1::int[])', [balanceRows.rows.map((row) => row.id)]);
    }
    const balance = await client.query(`
        INSERT INTO inventory_balances
          (product_id, lot_inventory_id, qr_unit_id, lot_number, location_id, location_code,
           inventory_status, quantity, last_transaction_id, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
        RETURNING *
    `, [fields.product_id, fields.lot_inventory_id || null, fields.qr_unit_id || null,
        fields.lot_number || null, fields.location_id || null, locationCode, inventoryStatus,
        nextQuantity, transaction.rows[0].id]);

    // ロット集約投影が存在する場合、後続のQR単位移動も同じ差分で同期する。
    if (fields.qr_unit_id) {
        await client.query(`
            UPDATE inventory_balances
            SET quantity = quantity + $1,
                last_transaction_id = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE product_id = $3
              AND COALESCE(lot_number, '') = COALESCE($4, '')
              AND COALESCE(location_code, '') = COALESCE($5, '')
              AND qr_unit_id IS NULL
              AND inventory_status = $6
        `, [quantityDelta, transaction.rows[0].id, fields.product_id,
            fields.lot_number || null, locationCode, inventoryStatus]);
    }

    let lot = null;
    if (fields.sync_lot_inventory) {
        const lotUpdate = await client.query(`
            UPDATE lot_inventory
            SET quantity = quantity + $1,
                location = COALESCE($2, location),
                location_id = COALESCE($3, location_id),
                status = CASE WHEN quantity + $1 = 0 THEN 'shipped' ELSE 'available' END,
                inventory_status = 'available',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $4 AND quantity + $1 >= 0
            RETURNING *
        `, [quantityDelta, locationCode, fields.location_id || null, fields.lot_inventory_id]);
        if (!lotUpdate.rows.length) {
            throw new InventoryLedgerError('ロット在庫が存在しないか不足しています', 'INSUFFICIENT_LOT_INVENTORY', 409);
        }
        lot = lotUpdate.rows[0];
    }

    return {
        transaction: transaction.rows[0],
        balance: balance.rows[0],
        lot,
        previous_quantity: currentQuantity,
        quantity_after: nextQuantity
    };
}

module.exports = {
    appendTransaction,
    InventoryLedgerError
};
