const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

const orderSchema = Joi.object({
    work_order_no: Joi.string().max(50).required(),
    production_plan_id: Joi.number().integer().allow(null),
    product_id: Joi.number().integer().required(),
    planned_quantity: Joi.number().integer().min(1).required(),
    due_date: Joi.date().iso().allow(null),
    finished_lot_number: Joi.string().max(80).allow('', null),
    notes: Joi.string().allow('', null)
});

const operationSchema = Joi.object({
    quantity: Joi.number().integer().min(1).allow(null),
    operator_name: Joi.string().max(255).allow('', null),
    notes: Joi.string().allow('', null)
});

const consumeSchema = Joi.object({
    qr_code: Joi.string().max(255).allow('', null),
    product_id: Joi.number().integer().allow(null),
    lot_number: Joi.string().max(80).allow('', null),
    consumed_quantity: Joi.number().integer().min(1).required(),
    operator_name: Joi.string().max(255).allow('', null),
    comment: Joi.string().allow('', null)
});

const receiptSchema = Joi.object({
    lot_number: Joi.string().max(80).required(),
    qr_code: Joi.string().max(255).allow('', null),
    received_quantity: Joi.number().integer().min(1).required(),
    location_code: Joi.string().max(50).required(),
    operator_name: Joi.string().max(255).allow('', null),
    comment: Joi.string().allow('', null)
});

async function upsertBalance(client, {
    product_id,
    lot_inventory_id,
    qr_unit_id,
    lot_number,
    location_id,
    location_code,
    inventory_status = 'available',
    quantity_delta,
    last_transaction_id
}) {
    const result = await client.query(`
        INSERT INTO inventory_balances
          (product_id, lot_inventory_id, qr_unit_id, lot_number, location_id,
           location_code, inventory_status, quantity, last_transaction_id, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
        ON CONFLICT (
          product_id,
          COALESCE(lot_number, ''),
          COALESCE(qr_unit_id, 0),
          COALESCE(location_code, ''),
          inventory_status
        ) DO UPDATE SET
          quantity = inventory_balances.quantity + EXCLUDED.quantity,
          lot_inventory_id = COALESCE(EXCLUDED.lot_inventory_id, inventory_balances.lot_inventory_id),
          location_id = COALESCE(EXCLUDED.location_id, inventory_balances.location_id),
          last_transaction_id = EXCLUDED.last_transaction_id,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
    `, [product_id, lot_inventory_id || null, qr_unit_id || null, lot_number || null,
        location_id || null, location_code || null, inventory_status, quantity_delta, last_transaction_id || null]);
    return result.rows[0];
}

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mo.*, p.product_code, p.product_name,
                   COUNT(op.id)::int AS operation_count,
                   COUNT(op.id) FILTER (WHERE op.status = 'completed')::int AS completed_operations
            FROM manufacturing_orders mo
            JOIN products p ON p.id = mo.product_id
            LEFT JOIN manufacturing_order_operations op ON op.manufacturing_order_id = mo.id
            GROUP BY mo.id, p.product_code, p.product_name
            ORDER BY mo.created_at DESC, mo.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching manufacturing orders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const order = await pool.query(`
            SELECT mo.*, p.product_code, p.product_name
            FROM manufacturing_orders mo
            JOIN products p ON p.id = mo.product_id
            WHERE mo.id = $1
        `, [req.params.id]);
        if (!order.rows.length) return res.status(404).json({ error: 'Manufacturing order not found' });
        const operations = await pool.query(`
            SELECT op.*, mp.process_code, mp.process_name
            FROM manufacturing_order_operations op
            JOIN manufacturing_processes mp ON mp.id = op.process_id
            WHERE op.manufacturing_order_id = $1
            ORDER BY op.operation_seq
        `, [req.params.id]);
        const consumptions = await pool.query(`
            SELECT c.*, p.product_code, p.product_name
            FROM manufacturing_material_consumptions c
            LEFT JOIN products p ON p.id = c.component_product_id
            WHERE c.manufacturing_order_id = $1
            ORDER BY c.created_at DESC, c.id DESC
        `, [req.params.id]);
        const receipts = await pool.query(`
            SELECT r.*, p.product_code, p.product_name
            FROM manufacturing_receipts r
            JOIN products p ON p.id = r.product_id
            WHERE r.manufacturing_order_id = $1
            ORDER BY r.created_at DESC, r.id DESC
        `, [req.params.id]);
        res.json({ order: order.rows[0], operations: operations.rows, consumptions: consumptions.rows, receipts: receipts.rows });
    } catch (error) {
        logger.error('Error fetching manufacturing order:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = orderSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        await client.query('BEGIN');
        const order = await client.query(`
            INSERT INTO manufacturing_orders
              (work_order_no, production_plan_id, product_id, planned_quantity, due_date, finished_lot_number, status, notes)
            VALUES ($1,$2,$3,$4,$5,$6,'released',$7)
            RETURNING *
        `, [value.work_order_no, value.production_plan_id || null, value.product_id, value.planned_quantity,
            value.due_date || null, value.finished_lot_number || null, value.notes || null]);
        const processes = await client.query(`
            SELECT *
            FROM manufacturing_processes
            WHERE is_active = true
            ORDER BY process_order, id
        `);
        const operations = [];
        for (const process of processes.rows) {
            const inserted = await client.query(`
                INSERT INTO manufacturing_order_operations
                  (manufacturing_order_id, process_id, operation_seq, planned_quantity, status)
                VALUES ($1,$2,$3,$4,'pending')
                RETURNING *
            `, [order.rows[0].id, process.id, process.process_order, value.planned_quantity]);
            operations.push(inserted.rows[0]);
        }
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, product_id, quantity, source_type, source_id, after_data, comment)
            VALUES ('manufacturing','manufacturing_order_released','success',$1,$2,'manufacturing_order',$3,$4::jsonb,$5)
        `, [value.product_id, value.planned_quantity, order.rows[0].id, JSON.stringify({ operation_count: operations.length }), value.notes || '製造指図を発行']);
        await client.query('COMMIT');
        res.status(201).json({ order: order.rows[0], operations });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creating manufacturing order:', error);
        if (error.code === '23505') return res.status(409).json({ error: '製造指図番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.patch('/:id/operations/:operationId/start', async (req, res) => {
    try {
        const { error, value } = operationSchema.validate(req.body || {});
        if (error) return res.status(400).json({ error: error.details[0].message });
        const result = await pool.query(`
            UPDATE manufacturing_order_operations
            SET status='started',
                started_quantity = COALESCE($1, planned_quantity),
                operator_name = COALESCE($2, operator_name),
                notes = COALESCE($3, notes),
                started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            WHERE id=$4 AND manufacturing_order_id=$5
            RETURNING *
        `, [value.quantity || null, value.operator_name || null, value.notes || null, req.params.operationId, req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Operation not found' });
        await pool.query("UPDATE manufacturing_orders SET status='in_progress', started_at=COALESCE(started_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=$1", [req.params.id]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error starting manufacturing operation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/:id/operations/:operationId/complete', async (req, res) => {
    try {
        const { error, value } = operationSchema.validate(req.body || {});
        if (error) return res.status(400).json({ error: error.details[0].message });
        const result = await pool.query(`
            UPDATE manufacturing_order_operations
            SET status='completed',
                completed_quantity = COALESCE($1, planned_quantity),
                operator_name = COALESCE($2, operator_name),
                notes = COALESCE($3, notes),
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id=$4 AND manufacturing_order_id=$5
            RETURNING *
        `, [value.quantity || null, value.operator_name || null, value.notes || null, req.params.operationId, req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Operation not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error completing manufacturing operation:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:id/consume-material', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = consumeSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
        if (!value.qr_code && !value.product_id) {
            return res.status(400).json({ error: 'qr_code または product_id が必要です' });
        }

        await client.query('BEGIN');
        const order = await client.query('SELECT * FROM manufacturing_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!order.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Manufacturing order not found' });
        }

        let target;
        if (value.qr_code) {
            const qr = await client.query(`
                SELECT qu.*, ib.quantity AS balance_quantity, ib.location_id AS balance_location_id, ib.location_code AS balance_location_code
                FROM qr_units qu
                LEFT JOIN inventory_balances ib ON ib.qr_unit_id = qu.id AND ib.inventory_status='available'
                WHERE qu.qr_code=$1
                ORDER BY ib.updated_at DESC NULLS LAST
                LIMIT 1
            `, [value.qr_code]);
            if (!qr.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'QR unit not found' });
            }
            target = {
                product_id: qr.rows[0].product_id,
                lot_inventory_id: qr.rows[0].lot_inventory_id,
                qr_unit_id: qr.rows[0].id,
                lot_number: qr.rows[0].lot_number,
                qr_code: qr.rows[0].qr_code,
                location_id: qr.rows[0].balance_location_id || qr.rows[0].location_id,
                location_code: qr.rows[0].balance_location_code || qr.rows[0].location,
                available_quantity: Number(qr.rows[0].balance_quantity || qr.rows[0].current_quantity || qr.rows[0].quantity || 0)
            };
        } else {
            const balance = await client.query(`
                SELECT *
                FROM inventory_balances
                WHERE product_id=$1
                  AND inventory_status='available'
                  AND ($2::text IS NULL OR lot_number=$2)
                ORDER BY quantity DESC, updated_at DESC
                LIMIT 1
            `, [value.product_id, value.lot_number || null]);
            if (!balance.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Available inventory not found' });
            }
            target = {
                product_id: balance.rows[0].product_id,
                lot_inventory_id: balance.rows[0].lot_inventory_id,
                qr_unit_id: balance.rows[0].qr_unit_id,
                lot_number: balance.rows[0].lot_number,
                qr_code: null,
                location_id: balance.rows[0].location_id,
                location_code: balance.rows[0].location_code,
                available_quantity: Number(balance.rows[0].quantity || 0)
            };
        }
        if (value.consumed_quantity > target.available_quantity) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '利用可能数量を超えています', available_quantity: target.available_quantity });
        }

        const quantityAfter = target.available_quantity - value.consumed_quantity;
        const tx = await client.query(`
            INSERT INTO inventory_transactions
              (transaction_type, transaction_status, product_id, lot_inventory_id, qr_unit_id,
               lot_number, location_id, location_code, quantity_delta, quantity_after,
               source_type, source_id, reason_code, comment, created_by)
            VALUES ('manufacturing_consumption','posted',$1,$2,$3,$4,$5,$6,$7,$8,'manufacturing_order',$9,'manufacturing_material_consumption',$10,$11)
            RETURNING *
        `, [target.product_id, target.lot_inventory_id, target.qr_unit_id, target.lot_number,
            target.location_id, target.location_code, -value.consumed_quantity, quantityAfter, req.params.id,
            value.comment || '製造部品消費', value.operator_name || 'manufacturing-orders-api']);
        await upsertBalance(client, {
            product_id: target.product_id,
            lot_inventory_id: target.lot_inventory_id,
            qr_unit_id: target.qr_unit_id,
            lot_number: target.lot_number,
            location_id: target.location_id,
            location_code: target.location_code,
            quantity_delta: -value.consumed_quantity,
            last_transaction_id: tx.rows[0].id
        });
        if (target.lot_inventory_id) {
            await client.query('UPDATE lot_inventory SET quantity=GREATEST(0, quantity - $1), updated_at=CURRENT_TIMESTAMP WHERE id=$2', [value.consumed_quantity, target.lot_inventory_id]);
        }
        if (target.qr_unit_id) {
            await client.query('UPDATE qr_units SET current_quantity=GREATEST(0, COALESCE(current_quantity, quantity) - $1), last_transaction_id=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$3', [value.consumed_quantity, tx.rows[0].id, target.qr_unit_id]);
        }
        const consumption = await client.query(`
            INSERT INTO manufacturing_material_consumptions
              (manufacturing_order_id, component_product_id, lot_inventory_id, qr_unit_id,
               lot_number, qr_code, consumed_quantity, inventory_transaction_id, operator_name, comment)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *
        `, [req.params.id, target.product_id, target.lot_inventory_id, target.qr_unit_id,
            target.lot_number, target.qr_code, value.consumed_quantity, tx.rows[0].id,
            value.operator_name || null, value.comment || null]);
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, product_id, lot_inventory_id, qr_unit_id, lot_number, qr_code, quantity, source_type, source_id, source_line_id, comment)
            VALUES ('manufacturing','material_consumed','success',$1,$2,$3,$4,$5,$6,'manufacturing_order',$7,$8,$9)
        `, [target.product_id, target.lot_inventory_id, target.qr_unit_id, target.lot_number, target.qr_code,
            value.consumed_quantity, req.params.id, consumption.rows[0].id, value.comment || '製造部品を消費']);
        await client.query('COMMIT');
        res.status(201).json({ consumption: consumption.rows[0], transaction: tx.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error consuming manufacturing material:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.post('/:id/receive-finished-good', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = receiptSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        await client.query('BEGIN');
        const orderResult = await client.query('SELECT * FROM manufacturing_orders WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!orderResult.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Manufacturing order not found' });
        }
        const order = orderResult.rows[0];
        const loc = await client.query(`
            INSERT INTO locations (location_code, location_name, location_type)
            VALUES ($1,$1,'warehouse')
            ON CONFLICT (location_code) DO UPDATE SET updated_at=CURRENT_TIMESTAMP
            RETURNING *
        `, [value.location_code]);
        const lot = await client.query(`
            INSERT INTO lot_inventory
              (product_id, lot_number, quantity, manufacturing_date, location, location_id, status, inventory_status, notes)
            VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,'available','available','製造完成入庫')
            ON CONFLICT (product_id, lot_number) DO UPDATE SET
              quantity = lot_inventory.quantity + EXCLUDED.quantity,
              location = EXCLUDED.location,
              location_id = EXCLUDED.location_id,
              updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [order.product_id, value.lot_number, value.received_quantity, value.location_code, loc.rows[0].id]);
        let qrUnit = null;
        if (value.qr_code) {
            const qr = await client.query(`
                INSERT INTO qr_units
                  (qr_code, product_id, lot_inventory_id, lot_number, quantity, current_quantity, unit_type, status, location, location_id)
                VALUES ($1,$2,$3,$4,$5,$5,'unit','available',$6,$7)
                ON CONFLICT (qr_code) DO UPDATE SET
                  product_id=EXCLUDED.product_id,
                  lot_inventory_id=EXCLUDED.lot_inventory_id,
                  lot_number=EXCLUDED.lot_number,
                  quantity=EXCLUDED.quantity,
                  current_quantity=EXCLUDED.current_quantity,
                  status='available',
                  location=EXCLUDED.location,
                  location_id=EXCLUDED.location_id,
                  updated_at=CURRENT_TIMESTAMP
                RETURNING *
            `, [value.qr_code, order.product_id, lot.rows[0].id, value.lot_number, value.received_quantity, value.location_code, loc.rows[0].id]);
            qrUnit = qr.rows[0];
        }
        const tx = await client.query(`
            INSERT INTO inventory_transactions
              (transaction_type, transaction_status, product_id, lot_inventory_id, qr_unit_id,
               lot_number, location_id, location_code, quantity_delta, quantity_after,
               source_type, source_id, reason_code, comment, created_by)
            VALUES ('manufacturing_receipt','posted',$1,$2,$3,$4,$5,$6,$7,$8,'manufacturing_order',$9,'manufacturing_finished_receipt',$10,$11)
            RETURNING *
        `, [order.product_id, lot.rows[0].id, qrUnit ? qrUnit.id : null, value.lot_number,
            loc.rows[0].id, value.location_code, value.received_quantity, lot.rows[0].quantity,
            req.params.id, value.comment || '製造完成品入庫', value.operator_name || 'manufacturing-orders-api']);
        await upsertBalance(client, {
            product_id: order.product_id,
            lot_inventory_id: lot.rows[0].id,
            qr_unit_id: qrUnit ? qrUnit.id : null,
            lot_number: value.lot_number,
            location_id: loc.rows[0].id,
            location_code: value.location_code,
            quantity_delta: value.received_quantity,
            last_transaction_id: tx.rows[0].id
        });
        if (qrUnit) {
            await client.query('UPDATE qr_units SET last_transaction_id=$1 WHERE id=$2', [tx.rows[0].id, qrUnit.id]);
        }
        const receipt = await client.query(`
            INSERT INTO manufacturing_receipts
              (manufacturing_order_id, product_id, lot_inventory_id, qr_unit_id, lot_number, qr_code,
               received_quantity, location_id, location_code, inventory_transaction_id, operator_name, comment)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            RETURNING *
        `, [req.params.id, order.product_id, lot.rows[0].id, qrUnit ? qrUnit.id : null,
            value.lot_number, value.qr_code || null, value.received_quantity, loc.rows[0].id,
            value.location_code, tx.rows[0].id, value.operator_name || null, value.comment || null]);
        const completedQuantity = Number(order.completed_quantity || 0) + value.received_quantity;
        const status = completedQuantity >= Number(order.planned_quantity || 0) ? 'completed' : 'in_progress';
        const updatedOrder = await client.query(`
            UPDATE manufacturing_orders
            SET completed_quantity=$1, status=$2::varchar, finished_lot_number=COALESCE(finished_lot_number,$3),
                completed_at=CASE WHEN $2::text='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=$4
            RETURNING *
        `, [completedQuantity, status, value.lot_number, req.params.id]);
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, product_id, lot_inventory_id, qr_unit_id, lot_number, qr_code, quantity, source_type, source_id, source_line_id, comment)
            VALUES ('manufacturing','finished_good_received','success',$1,$2,$3,$4,$5,$6,'manufacturing_order',$7,$8,$9)
        `, [order.product_id, lot.rows[0].id, qrUnit ? qrUnit.id : null, value.lot_number, value.qr_code || null,
            value.received_quantity, req.params.id, receipt.rows[0].id, value.comment || '製造完成品を入庫']);
        await client.query('COMMIT');
        res.status(201).json({ order: updatedOrder.rows[0], receipt: receipt.rows[0], lot: lot.rows[0], qr_unit: qrUnit, transaction: tx.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error receiving finished good:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
