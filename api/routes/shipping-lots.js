/**
 * 出荷ロット割り当て API(明細=製品ごとに、ロットから出荷数を割り当て)
 * マウント: /shipping-instruction-lines と /api/shipping-instruction-lines
 * QR スキャンで特定したロットからの出荷数を記録し、lot_inventory を引き当て・減算する。
 */
const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const logger = require('../lib/logger');
const { recordAuditEvent } = require('../lib/audit');
const { appendTransaction, InventoryLedgerError } = require('../lib/inventory-ledger');

// 明細の対象製品のロット一覧(出荷可能な在庫)
router.get('/:lineId/lots', async (req, res) => {
    try {
        const { lineId } = req.params;
        const line = await pool.query('SELECT * FROM shipping_instruction_lines WHERE id = $1', [lineId]);
        if (line.rows.length === 0) return res.status(404).json({ error: 'Line not found' });
        const productId = line.rows[0].product_id;
        const lots = await pool.query(`
            SELECT id, lot_number, quantity, manufacturing_date, expiry_date, location, status
            FROM lot_inventory
            WHERE product_id = $1 AND quantity > 0 AND status IN ('available','reserved')
            ORDER BY COALESCE(expiry_date, '9999-12-31') ASC, lot_number ASC
        `, [productId]);
        res.json(lots.rows);
    } catch (error) {
        logger.error('Error fetching lots for line:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 明細のこれまでの割り当て一覧
router.get('/:lineId/allocations', async (req, res) => {
    try {
        const { lineId } = req.params;
        const result = await pool.query(`
            SELECT id, lot_number, product_id, shipped_quantity, operator_name, status, scanned_at
            FROM shipping_lot_allocations
            WHERE shipping_instruction_line_id = $1 AND status = 'shipped'
            ORDER BY scanned_at
        `, [lineId]);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching allocations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロットから出荷数を割り当て(QRスキャンで lot_number を特定 → 出荷数入力)
// body: { lot_number, shipped_quantity, operator_name }
router.post('/:lineId/allocate', async (req, res) => {
    const client = await pool.connect();
    try {
        const { lineId } = req.params;
        const { lot_number, shipped_quantity, operator_name } = req.body;
        const qty = parseInt(shipped_quantity, 10);
        if (!lot_number || !Number.isInteger(qty) || qty <= 0) {
            return res.status(400).json({ error: 'lot_number と正の shipped_quantity が必要です' });
        }

        await client.query('BEGIN');

        const lineRes = await client.query(
            'SELECT * FROM shipping_instruction_lines WHERE id = $1 FOR UPDATE', [lineId]);
        if (lineRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Line not found' });
        }
        const line = lineRes.rows[0];

        // 指示数量の超過を防止
        const remaining = line.quantity - line.shipped_quantity;
        if (qty > remaining) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `残数量(${remaining})を超えています`, remaining });
        }

        // 対象製品のロットを検証(行ロック)
        const lotRes = await client.query(
            'SELECT * FROM lot_inventory WHERE lot_number = $1 AND product_id = $2 FOR UPDATE',
            [lot_number, line.product_id]);
        if (lotRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'この製品に該当するロットが見つかりません' });
        }
        const lot = lotRes.rows[0];
        if (lot.quantity < qty) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `ロット在庫(${lot.quantity})が不足しています`, lotQuantity: lot.quantity });
        }

        // 割り当て記録
        const alloc = await client.query(`
            INSERT INTO shipping_lot_allocations
              (shipping_instruction_line_id, lot_inventory_id, lot_number, product_id, shipped_quantity, operator_name)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
        `, [lineId, lot.id, lot_number, line.product_id, qty, operator_name || null]);

        const movement = await appendTransaction(client, {
            transaction_type: 'shipping_allocation',
            inventory_status: 'available',
            product_id: line.product_id,
            lot_inventory_id: lot.id,
            lot_number,
            location_id: lot.location_id || null,
            location_code: lot.location || null,
            quantity_delta: -qty,
            opening_quantity: Number(lot.quantity || 0),
            trust_opening_quantity: true,
            sync_lot_inventory: true,
            source_type: 'shipping_lot_allocation',
            source_id: alloc.rows[0].id,
            source_line_id: line.id,
            comment: 'ロット別出荷数量を在庫引当',
            created_by: operator_name || 'shipping-lots-api'
        });
        const newLotQty = movement.quantity_after;

        // 明細の出荷済み更新・ステータス遷移
        const newShipped = line.shipped_quantity + qty;
        const newStatus = newShipped >= line.quantity ? 'completed' : (newShipped > 0 ? 'partial' : 'pending');
        await client.query(
            `UPDATE shipping_instruction_lines
             SET shipped_quantity = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [newShipped, newStatus, lineId]);

        await recordAuditEvent(client, req, {
            shipping_instruction_id: line.shipping_instruction_id,
            line_id: line.id,
            allocation_id: alloc.rows[0].id,
            event_type: 'quantity_confirmed',
            event_status: 'success',
            product_id: line.product_id,
            lot_id: lot.id,
            lot_number,
            quantity: qty,
            before_data: {
                line_shipped_quantity: line.shipped_quantity,
                line_status: line.status,
                lot_quantity: lot.quantity
            },
            after_data: {
                line_shipped_quantity: newShipped,
                line_status: newStatus,
                lot_quantity: newLotQty
            },
            comment: 'ロット別出荷数量を確定'
        });

        await client.query('COMMIT');
        res.status(201).json({
            allocation: alloc.rows[0],
            inventory_transaction: movement.transaction,
            line: { id: line.id, quantity: line.quantity, shipped_quantity: newShipped, status: newStatus,
                    remaining_quantity: line.quantity - newShipped },
            lot: { lot_number, remaining_quantity: newLotQty }
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error allocating lot shipment:', error);
        if (error instanceof InventoryLedgerError) {
            return res.status(error.status).json({ error: error.message, code: error.code });
        }
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// 割り当ての取り消し(在庫戻し・明細出荷済み減算)
router.delete('/allocations/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');
        const aRes = await client.query(
            "SELECT * FROM shipping_lot_allocations WHERE id = $1 AND status = 'shipped' FOR UPDATE", [id]);
        if (aRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Allocation not found' });
        }
        const a = aRes.rows[0];
        let movement = null;
        if (a.lot_inventory_id) {
            const lotResult = await client.query(
                'SELECT * FROM lot_inventory WHERE id = $1 FOR UPDATE',
                [a.lot_inventory_id]);
            if (!lotResult.rows.length) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: '引当元ロットが存在しないため取消できません' });
            }
            const lot = lotResult.rows[0];
            movement = await appendTransaction(client, {
                transaction_type: 'shipping_cancel',
                inventory_status: 'available',
                product_id: a.product_id,
                lot_inventory_id: lot.id,
                lot_number: a.lot_number,
                location_id: lot.location_id || null,
                location_code: lot.location || null,
                quantity_delta: Number(a.shipped_quantity),
                opening_quantity: Number(lot.quantity || 0),
                trust_opening_quantity: true,
                sync_lot_inventory: true,
                source_type: 'shipping_lot_allocation_cancel',
                source_id: a.id,
                source_line_id: a.shipping_instruction_line_id,
                reason_code: 'allocation_cancelled',
                comment: 'ロット引当取消で在庫を戻す',
                created_by: 'shipping-lots-api'
            });
        }
        // 明細を戻す
        const lineRes = await client.query(
            'SELECT * FROM shipping_instruction_lines WHERE id = $1 FOR UPDATE',
            [a.shipping_instruction_line_id]);
        const line = lineRes.rows[0];
        const newShipped = Math.max(0, line.shipped_quantity - a.shipped_quantity);
        const newStatus = newShipped >= line.quantity ? 'completed' : (newShipped > 0 ? 'partial' : 'pending');
        await client.query(
            `UPDATE shipping_instruction_lines SET shipped_quantity = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [newShipped, newStatus, line.id]);
        // 割り当てを取消
        await client.query("UPDATE shipping_lot_allocations SET status = 'cancelled' WHERE id = $1", [id]);
        await recordAuditEvent(client, req, {
            shipping_instruction_id: line.shipping_instruction_id,
            line_id: line.id,
            allocation_id: a.id,
            event_type: 'lot_allocation_cancelled',
            event_status: 'success',
            product_id: a.product_id,
            lot_id: a.lot_inventory_id,
            lot_number: a.lot_number,
            quantity: a.shipped_quantity,
            before_data: {
                allocation_status: a.status,
                line_shipped_quantity: line.shipped_quantity,
                line_status: line.status
            },
            after_data: {
                allocation_status: 'cancelled',
                line_shipped_quantity: newShipped,
                line_status: newStatus
            },
            comment: 'ロット引当を取消'
        });
        await client.query('COMMIT');
        res.json({
            success: true,
            inventory_transaction: movement?.transaction || null,
            line: { id: line.id, shipped_quantity: newShipped, status: newStatus }
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error cancelling allocation:', error);
        if (error instanceof InventoryLedgerError) {
            return res.status(error.status).json({ error: error.message, code: error.code });
        }
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
