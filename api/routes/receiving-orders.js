const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const { appendTransaction, InventoryLedgerError } = require('../lib/inventory-ledger');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ro.*, s.supplier_code, s.supplier_name,
                   COUNT(rol.id)::int AS line_count,
                   COALESCE(SUM(rol.expected_quantity), 0)::int AS expected_quantity,
                   COALESCE(SUM(rol.received_quantity), 0)::int AS received_quantity
            FROM receiving_orders ro
            JOIN suppliers s ON s.id = ro.supplier_id
            LEFT JOIN receiving_order_lines rol ON rol.receiving_order_id = ro.id
            GROUP BY ro.id, s.supplier_code, s.supplier_name
            ORDER BY ro.created_at DESC, ro.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching receiving orders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const order = await pool.query(`
            SELECT ro.*, s.supplier_code, s.supplier_name
            FROM receiving_orders ro
            JOIN suppliers s ON s.id = ro.supplier_id
            WHERE ro.id = $1
        `, [req.params.id]);
        if (!order.rows.length) return res.status(404).json({ error: 'Receiving order not found' });
        const lines = await pool.query(`
            SELECT rol.*, p.product_code, p.product_name
            FROM receiving_order_lines rol
            JOIN products p ON p.id = rol.product_id
            WHERE rol.receiving_order_id = $1
            ORDER BY rol.id
        `, [req.params.id]);
        const results = await pool.query(`
            SELECT rr.*, p.product_code, p.product_name
            FROM receiving_results rr
            JOIN products p ON p.id = rr.product_id
            WHERE rr.receiving_order_id = $1
            ORDER BY rr.received_at DESC, rr.id DESC
        `, [req.params.id]);
        res.json({ receiving_order: order.rows[0], lines: lines.rows, results: results.rows });
    } catch (error) {
        logger.error('Error fetching receiving order:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const scanSchema = Joi.object({
    receiving_order_line_id: Joi.number().integer().required(),
    qr_code: Joi.string().max(255).allow('', null),
    lot_number: Joi.string().max(50).required(),
    received_quantity: Joi.number().integer().min(1).required(),
    accepted_quantity: Joi.number().integer().min(0),
    rejected_quantity: Joi.number().integer().min(0).default(0),
    location_code: Joi.string().max(50).default('RECEIVING'),
    inspection_status: Joi.string().valid('accepted', 'rejected', 'on_hold').default('accepted'),
    reason_code: Joi.string().max(80).allow('', null),
    comment: Joi.string().allow('', null)
});

router.post('/:id/scan', async (req, res) => {
    const client = await pool.connect();
    try {
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        if (idempotencyKey.length > 120) {
            return res.status(400).json({ error: 'Idempotency-Key は120文字以内で指定してください' });
        }
        const { error, value } = scanSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
        const acceptedQuantity = value.accepted_quantity === undefined
            ? (value.inspection_status === 'accepted' ? value.received_quantity : 0)
            : value.accepted_quantity;
        const rejectedQuantity = value.rejected_quantity || (value.inspection_status === 'rejected' ? value.received_quantity : 0);
        if (acceptedQuantity + rejectedQuantity > value.received_quantity) {
            return res.status(400).json({ error: 'accepted_quantity + rejected_quantity が received_quantity を超えています' });
        }
        const holdQuantity = value.inspection_status === 'on_hold'
            ? value.received_quantity - acceptedQuantity - rejectedQuantity
            : 0;
        if (acceptedQuantity + rejectedQuantity + holdQuantity !== value.received_quantity) {
            return res.status(400).json({ error: 'received_quantity の全数量を合格・不合格・保留へ分類してください' });
        }
        if (value.qr_code && [acceptedQuantity, rejectedQuantity, holdQuantity].filter((quantity) => quantity > 0).length > 1) {
            return res.status(400).json({
                error: '1つのQRコードへ複数の在庫状態を割り当てることはできません',
                code: 'QR_MIXED_INVENTORY_STATUS'
            });
        }

        await client.query('BEGIN');
        const lineResult = await client.query(`
            SELECT rol.*, pol.purchase_order_id
            FROM receiving_order_lines rol
            LEFT JOIN purchase_order_lines pol ON pol.id = rol.purchase_order_line_id
            WHERE rol.id = $1 AND rol.receiving_order_id = $2
            FOR UPDATE OF rol
        `, [value.receiving_order_line_id, req.params.id]);
        if (!lineResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Receiving order line not found' });
        }
        const line = lineResult.rows[0];
        if (idempotencyKey) {
            const existingResult = await client.query(`
                SELECT * FROM receiving_results
                WHERE receiving_order_id = $1 AND idempotency_key = $2
                LIMIT 1
            `, [req.params.id, idempotencyKey]);
            if (existingResult.rows.length) {
                const existing = existingResult.rows[0];
                const sameRequest = Number(existing.receiving_order_line_id) === Number(line.id)
                    && String(existing.qr_code || '') === String(value.qr_code || '')
                    && String(existing.lot_number) === String(value.lot_number)
                    && Number(existing.received_quantity) === Number(value.received_quantity)
                    && Number(existing.accepted_quantity) === Number(acceptedQuantity)
                    && Number(existing.rejected_quantity) === Number(rejectedQuantity)
                    && String(existing.location_code || '') === String(value.location_code || '')
                    && String(existing.inspection_status || '') === String(value.inspection_status || '')
                    && String(existing.reason_code || '') === String(value.reason_code || '')
                    && String(existing.comment || '') === String(value.comment || '');
                if (!sameRequest) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: 'Idempotency-Key は別の入庫内容で使用済みです',
                        code: 'IDEMPOTENCY_KEY_REUSED'
                    });
                }
                await client.query('COMMIT');
                return res.json({
                    success: true,
                    idempotent: true,
                    receiving_result: existing,
                    line: {
                        id: line.id,
                        expected_quantity: line.expected_quantity,
                        received_quantity: line.received_quantity,
                        accepted_quantity: line.accepted_quantity,
                        rejected_quantity: line.rejected_quantity,
                        status: line.status
                    }
                });
            }
        }
        const remaining = Number(line.expected_quantity || 0) - Number(line.received_quantity || 0);
        if (value.received_quantity > remaining) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `残入庫数量(${remaining})を超えています`, remaining_quantity: remaining });
        }

        const loc = await client.query(`
            INSERT INTO locations (location_code, location_name, location_type)
            VALUES ($1,$1,'warehouse')
            ON CONFLICT (location_code) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [value.location_code]);
        const lot = await client.query(`
            INSERT INTO lot_inventory
              (product_id, lot_number, quantity, location, location_id, status, inventory_status, notes)
            VALUES ($1,$2,0,$3,$4,'available','available','入庫検品から作成')
            ON CONFLICT (product_id, lot_number) DO UPDATE SET
              location = EXCLUDED.location,
              location_id = EXCLUDED.location_id,
              updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [line.product_id, value.lot_number, value.location_code, loc.rows[0].id]);

        let qrUnit = null;
        if (value.qr_code) {
            const existingQr = await client.query(`
                SELECT qu.*,
                       EXISTS (
                           SELECT 1 FROM receiving_results rr WHERE rr.qr_unit_id = qu.id
                       ) AS has_receiving_result
                FROM qr_units qu
                WHERE qu.qr_code = $1
                FOR UPDATE
            `, [value.qr_code]);
            if (existingQr.rows.length) {
                const existing = existingQr.rows[0];
                if (Number(existing.product_id) !== Number(line.product_id)
                    || String(existing.lot_number) !== String(value.lot_number)) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: 'QRコードは別の品目またはロットへ登録済みです',
                        code: 'QR_IDENTITY_CONFLICT'
                    });
                }
                if (existing.has_receiving_result) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: 'QRコードは入庫済みです',
                        code: 'QR_ALREADY_RECEIVED'
                    });
                }
            }

            const qrStatus = value.inspection_status === 'on_hold'
                ? 'on_hold'
                : value.inspection_status === 'rejected' ? 'defective' : 'available';
            const qrResult = existingQr.rows.length
                ? await client.query(`
                    UPDATE qr_units
                    SET lot_inventory_id = $1,
                        quantity = $2,
                        current_quantity = $2,
                        status = $3,
                        location = $4,
                        location_id = $5,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $6
                    RETURNING *
                `, [lot.rows[0].id, value.received_quantity, qrStatus,
                    value.location_code, loc.rows[0].id, existingQr.rows[0].id])
                : await client.query(`
                    INSERT INTO qr_units
                      (qr_code, product_id, lot_inventory_id, lot_number, quantity, current_quantity,
                       unit_type, status, location, location_id)
                    VALUES ($1,$2,$3,$4,$5,$5,'unit',$6,$7,$8)
                    RETURNING *
                `, [value.qr_code, line.product_id, lot.rows[0].id, value.lot_number,
                    value.received_quantity, qrStatus, value.location_code, loc.rows[0].id]);
            qrUnit = qrResult.rows[0];
        }

        const result = await client.query(`
            INSERT INTO receiving_results
              (receiving_order_id, receiving_order_line_id, purchase_order_line_id, product_id,
               lot_inventory_id, qr_unit_id, lot_number, qr_code, received_quantity,
               accepted_quantity, rejected_quantity, location_id, location_code,
               inspection_status, reason_code, comment, idempotency_key)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            RETURNING *
        `, [req.params.id, line.id, line.purchase_order_line_id, line.product_id, lot.rows[0].id,
            qrUnit ? qrUnit.id : null, value.lot_number, value.qr_code || null, value.received_quantity,
            acceptedQuantity, rejectedQuantity, loc.rows[0].id, value.location_code,
            value.inspection_status, value.reason_code || null, value.comment || null,
            idempotencyKey || null]);

        const movements = [];
        if (acceptedQuantity > 0) {
            movements.push(await appendTransaction(client, {
                transaction_type: 'receiving',
                inventory_status: 'available',
                product_id: line.product_id,
                lot_inventory_id: lot.rows[0].id,
                qr_unit_id: qrUnit ? qrUnit.id : null,
                lot_number: value.lot_number,
                location_id: loc.rows[0].id,
                location_code: value.location_code,
                quantity_delta: acceptedQuantity,
                opening_quantity: qrUnit ? 0 : Number(lot.rows[0].quantity || 0),
                trust_opening_quantity: true,
                sync_lot_inventory: true,
                source_type: 'receiving_result',
                source_id: result.rows[0].id,
                source_line_id: line.id,
                reason_code: value.reason_code || null,
                comment: value.comment || '入庫検品で合格数量を在庫反映',
                created_by: 'receiving-orders-api'
            }));
        }
        if (holdQuantity > 0) {
            movements.push(await appendTransaction(client, {
                transaction_type: 'hold',
                inventory_status: 'on_hold',
                product_id: line.product_id,
                lot_inventory_id: lot.rows[0].id,
                qr_unit_id: qrUnit ? qrUnit.id : null,
                lot_number: value.lot_number,
                location_id: loc.rows[0].id,
                location_code: value.location_code,
                quantity_delta: holdQuantity,
                source_type: 'receiving_result',
                source_id: result.rows[0].id,
                source_line_id: line.id,
                reason_code: value.reason_code || 'receiving_hold',
                comment: value.comment || '入庫検品で保留数量を隔離',
                created_by: 'receiving-orders-api'
            }));
        }
        if (rejectedQuantity > 0) {
            movements.push(await appendTransaction(client, {
                transaction_type: 'defective',
                inventory_status: 'defective',
                product_id: line.product_id,
                lot_inventory_id: lot.rows[0].id,
                qr_unit_id: qrUnit ? qrUnit.id : null,
                lot_number: value.lot_number,
                location_id: loc.rows[0].id,
                location_code: value.location_code,
                quantity_delta: rejectedQuantity,
                source_type: 'receiving_result',
                source_id: result.rows[0].id,
                source_line_id: line.id,
                reason_code: value.reason_code || 'receiving_rejected',
                comment: value.comment || '入庫検品で不合格数量を隔離',
                created_by: 'receiving-orders-api'
            }));
        }

        const newReceived = Number(line.received_quantity || 0) + value.received_quantity;
        const newAccepted = Number(line.accepted_quantity || 0) + acceptedQuantity;
        const newRejected = Number(line.rejected_quantity || 0) + rejectedQuantity;
        const lineStatus = newReceived >= Number(line.expected_quantity || 0) ? 'received' : 'partial';
        await client.query(`
            UPDATE receiving_order_lines
            SET received_quantity=$1, accepted_quantity=$2, rejected_quantity=$3, status=$4, updated_at=CURRENT_TIMESTAMP
            WHERE id=$5
        `, [newReceived, newAccepted, newRejected, lineStatus, line.id]);
        if (line.purchase_order_line_id) {
            await client.query(`
                UPDATE purchase_order_lines
                SET received_quantity = received_quantity + $1,
                    status = CASE WHEN received_quantity + $1 >= ordered_quantity THEN 'received' ELSE 'partial' END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [value.received_quantity, line.purchase_order_line_id]);
        }
        await client.query("UPDATE receiving_orders SET status='in_progress', updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='pending'", [req.params.id]);
        await client.query(`
            INSERT INTO operation_events
              (event_domain, event_type, event_status, product_id, lot_inventory_id, qr_unit_id,
               lot_number, qr_code, quantity, source_type, source_id, source_line_id, after_data, reason_code, comment)
            VALUES ('receiving','receiving_scanned',$1,$2,$3,$4,$5,$6,$7,'receiving_order',$8,$9,$10::jsonb,$11,$12)
        `, [
            value.inspection_status === 'accepted' ? 'success' : value.inspection_status,
            line.product_id, lot.rows[0].id, qrUnit ? qrUnit.id : null, value.lot_number, value.qr_code || null,
            value.received_quantity, req.params.id, line.id,
            JSON.stringify({ receiving_result_id: result.rows[0].id, accepted_quantity: acceptedQuantity, rejected_quantity: rejectedQuantity }),
            value.reason_code || null, value.comment || 'QR 入庫検品'
        ]);

        await client.query('COMMIT');
        res.status(201).json({
            success: true,
            idempotent: false,
            receiving_result: result.rows[0],
            lot: { ...lot.rows[0], quantity: movements.find((movement) => movement.lot)?.lot.quantity || Number(lot.rows[0].quantity || 0) },
            qr_unit: qrUnit,
            inventory_transactions: movements.map((movement) => movement.transaction),
            line: {
                id: line.id,
                expected_quantity: line.expected_quantity,
                received_quantity: newReceived,
                accepted_quantity: newAccepted,
                rejected_quantity: newRejected,
                status: lineStatus
            }
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error scanning receiving order:', error);
        if (error instanceof InventoryLedgerError) {
            return res.status(error.status).json({ error: error.message, code: error.code });
        }
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.patch('/:id/complete', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderLock = await client.query(
            'SELECT * FROM receiving_orders WHERE id = $1 FOR UPDATE',
            [req.params.id],
        );
        if (!orderLock.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Receiving order not found' });
        }
        const summary = await client.query(`
            SELECT COUNT(id)::int AS line_count,
                   COUNT(id) FILTER (WHERE received_quantity >= expected_quantity)::int AS completed_lines
            FROM receiving_order_lines
            WHERE receiving_order_id = $1
        `, [req.params.id]);
        const row = { ...orderLock.rows[0], ...summary.rows[0] };
        if (Number(row.completed_lines || 0) < Number(row.line_count || 0)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '未入庫の明細があります', summary: row });
        }
        const updated = await client.query("UPDATE receiving_orders SET status='received', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *", [req.params.id]);
        if (updated.rows[0].purchase_order_id) {
            await client.query("UPDATE purchase_orders SET status='received', updated_at=CURRENT_TIMESTAMP WHERE id=$1", [updated.rows[0].purchase_order_id]);
        }
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('receiving','receiving_completed','success','receiving_order',$1,$2::jsonb,$3)
        `, [req.params.id, JSON.stringify({ line_count: row.line_count }), req.body?.comment || '入庫予定を完了']);
        await client.query('COMMIT');
        res.json({ success: true, receiving_order: updated.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error completing receiving order:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
