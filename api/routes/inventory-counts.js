const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

const sessionSchema = Joi.object({
    count_no: Joi.string().max(50).required(),
    count_name: Joi.string().max(255).required(),
    location_code: Joi.string().max(50).allow('', null),
    notes: Joi.string().allow('', null)
});

const scanSchema = Joi.object({
    qr_code: Joi.string().max(255).allow('', null),
    product_id: Joi.number().integer().when('qr_code', { is: Joi.exist().not(null, ''), then: Joi.optional(), otherwise: Joi.required() }),
    lot_number: Joi.string().max(50).allow('', null),
    location_code: Joi.string().max(50).allow('', null),
    counted_quantity: Joi.number().integer().min(0).required(),
    reason_code: Joi.string().max(80).allow('', null),
    comment: Joi.string().allow('', null)
});

const approveSchema = Joi.object({
    approved_by: Joi.string().max(255).allow('', null),
    reason_code: Joi.string().max(80).allow('', null),
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
            SELECT s.*,
                   COUNT(l.id)::int AS line_count,
                   COUNT(l.id) FILTER (WHERE l.count_status IN ('counted','variance'))::int AS counted_lines,
                   COUNT(l.id) FILTER (WHERE COALESCE(l.variance_quantity, 0) <> 0)::int AS variance_lines,
                   COALESCE(SUM(l.variance_quantity), 0)::int AS variance_quantity
            FROM inventory_count_sessions s
            LEFT JOIN inventory_count_lines l ON l.inventory_count_session_id = s.id
            GROUP BY s.id
            ORDER BY s.created_at DESC, s.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory count sessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const session = await pool.query('SELECT * FROM inventory_count_sessions WHERE id = $1', [req.params.id]);
        if (!session.rows.length) return res.status(404).json({ error: 'Inventory count session not found' });
        const lines = await pool.query(`
            SELECT l.*, p.product_code, p.product_name
            FROM inventory_count_lines l
            JOIN products p ON p.id = l.product_id
            WHERE l.inventory_count_session_id = $1
            ORDER BY l.count_status, p.product_code, l.lot_number NULLS LAST, l.qr_code NULLS LAST
        `, [req.params.id]);
        res.json({ session: session.rows[0], lines: lines.rows });
    } catch (error) {
        logger.error('Error fetching inventory count session:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = sessionSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        await client.query('BEGIN');
        const session = await client.query(`
            INSERT INTO inventory_count_sessions (count_no, count_name, location_code, status, started_at, notes)
            VALUES ($1,$2,$3,'in_progress',CURRENT_TIMESTAMP,$4)
            RETURNING *
        `, [value.count_no, value.count_name, value.location_code || null, value.notes || null]);

        const params = [];
        const where = [];
        if (value.location_code) {
            params.push(value.location_code);
            where.push(`ib.location_code = $${params.length}`);
        }
        params.push(session.rows[0].id);
        const sessionParam = `$${params.length}`;
        const snapshot = await client.query(`
            INSERT INTO inventory_count_lines
              (inventory_count_session_id, product_id, lot_inventory_id, qr_unit_id, lot_number,
               qr_code, location_id, location_code, expected_quantity, count_status)
            SELECT ${sessionParam}, ib.product_id, ib.lot_inventory_id, ib.qr_unit_id, ib.lot_number,
                   qu.qr_code, ib.location_id, ib.location_code, ib.quantity, 'pending'
            FROM inventory_balances ib
            LEFT JOIN qr_units qu ON qu.id = ib.qr_unit_id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ON CONFLICT DO NOTHING
            RETURNING *
        `, params);

        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('inventory_count','inventory_count_started','success','inventory_count',$1,$2::jsonb,$3)
        `, [session.rows[0].id, JSON.stringify({ line_count: snapshot.rows.length, location_code: value.location_code || null }), value.notes || '棚卸を開始']);
        await client.query('COMMIT');
        res.status(201).json({ session: session.rows[0], lines: snapshot.rows });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creating inventory count session:', error);
        if (error.code === '23505') return res.status(409).json({ error: '棚卸番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.post('/:id/scan', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = scanSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        await client.query('BEGIN');
        const session = await client.query('SELECT * FROM inventory_count_sessions WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!session.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Inventory count session not found' });
        }
        if (!['draft', 'in_progress'].includes(session.rows[0].status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '棚卸は入力可能な状態ではありません', status: session.rows[0].status });
        }

        let target = null;
        if (value.qr_code) {
            const qr = await client.query(`
                SELECT qu.*, p.product_code, p.product_name,
                       ib.id AS balance_id, ib.quantity AS expected_quantity,
                       ib.location_id AS balance_location_id, ib.location_code AS balance_location_code,
                       ib.lot_inventory_id AS balance_lot_inventory_id
                FROM qr_units qu
                JOIN products p ON p.id = qu.product_id
                LEFT JOIN inventory_balances ib ON ib.qr_unit_id = qu.id
                WHERE qu.qr_code = $1
                ORDER BY ib.updated_at DESC NULLS LAST
                LIMIT 1
            `, [value.qr_code]);
            if (!qr.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'QR unit not found' });
            }
            target = {
                product_id: qr.rows[0].product_id,
                lot_inventory_id: qr.rows[0].balance_lot_inventory_id || qr.rows[0].lot_inventory_id,
                qr_unit_id: qr.rows[0].id,
                lot_number: qr.rows[0].lot_number,
                qr_code: qr.rows[0].qr_code,
                location_id: qr.rows[0].balance_location_id || qr.rows[0].location_id,
                location_code: qr.rows[0].balance_location_code || value.location_code || qr.rows[0].location,
                expected_quantity: Number(qr.rows[0].expected_quantity || qr.rows[0].current_quantity || qr.rows[0].quantity || 0)
            };
        } else {
            const balance = await client.query(`
                SELECT *
                FROM inventory_balances
                WHERE product_id = $1
                  AND ($2::text IS NULL OR lot_number = $2)
                  AND ($3::text IS NULL OR location_code = $3)
                ORDER BY updated_at DESC
                LIMIT 1
            `, [value.product_id, value.lot_number || null, value.location_code || null]);
            target = {
                product_id: value.product_id,
                lot_inventory_id: balance.rows[0]?.lot_inventory_id || null,
                qr_unit_id: balance.rows[0]?.qr_unit_id || null,
                lot_number: value.lot_number || balance.rows[0]?.lot_number || null,
                qr_code: null,
                location_id: balance.rows[0]?.location_id || null,
                location_code: value.location_code || balance.rows[0]?.location_code || null,
                expected_quantity: Number(balance.rows[0]?.quantity || 0)
            };
        }

        const variance = value.counted_quantity - target.expected_quantity;
        const countStatus = variance === 0 ? 'counted' : 'variance';
        const line = await client.query(`
            INSERT INTO inventory_count_lines
              (inventory_count_session_id, product_id, lot_inventory_id, qr_unit_id, lot_number, qr_code,
               location_id, location_code, expected_quantity, counted_quantity, variance_quantity,
               count_status, reason_code, comment, counted_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CURRENT_TIMESTAMP)
            ON CONFLICT (
              inventory_count_session_id,
              product_id,
              COALESCE(lot_number, ''),
              COALESCE(qr_unit_id, 0),
              COALESCE(location_code, '')
            )
            DO UPDATE SET
              counted_quantity = EXCLUDED.counted_quantity,
              variance_quantity = EXCLUDED.variance_quantity,
              count_status = EXCLUDED.count_status,
              reason_code = EXCLUDED.reason_code,
              comment = EXCLUDED.comment,
              counted_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [req.params.id, target.product_id, target.lot_inventory_id, target.qr_unit_id, target.lot_number,
            target.qr_code, target.location_id, target.location_code, target.expected_quantity,
            value.counted_quantity, variance, countStatus, value.reason_code || null, value.comment || null]);

        await client.query("UPDATE inventory_count_sessions SET status='in_progress', updated_at=CURRENT_TIMESTAMP WHERE id=$1", [req.params.id]);
        await client.query(`
            INSERT INTO operation_events
              (event_domain, event_type, event_status, product_id, lot_inventory_id, qr_unit_id,
               lot_number, qr_code, quantity, source_type, source_id, source_line_id, after_data, reason_code, comment)
            VALUES ('inventory_count','inventory_count_scanned',$1,$2,$3,$4,$5,$6,$7,'inventory_count',$8,$9,$10::jsonb,$11,$12)
        `, [
            variance === 0 ? 'success' : 'warning', target.product_id, target.lot_inventory_id, target.qr_unit_id,
            target.lot_number, target.qr_code, value.counted_quantity, req.params.id, line.rows[0].id,
            JSON.stringify({ expected_quantity: target.expected_quantity, variance_quantity: variance }),
            value.reason_code || null, value.comment || '棚卸スキャン'
        ]);
        await client.query('COMMIT');
        res.status(201).json({ line: line.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error scanning inventory count:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.patch('/:id/complete', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE inventory_count_sessions
            SET status='counted', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE id=$1 AND status IN ('draft','in_progress')
            RETURNING *
        `, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Inventory count session not found or not completable' });
        res.json({ success: true, session: result.rows[0] });
    } catch (error) {
        logger.error('Error completing inventory count:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/:id/approve', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = approveSchema.validate(req.body || {});
        if (error) return res.status(400).json({ error: error.details[0].message });

        await client.query('BEGIN');
        const session = await client.query('SELECT * FROM inventory_count_sessions WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!session.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Inventory count session not found' });
        }
        if (session.rows[0].status !== 'counted') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '棚卸は承認可能な状態ではありません', status: session.rows[0].status });
        }

        const lines = await client.query(`
            SELECT *
            FROM inventory_count_lines
            WHERE inventory_count_session_id = $1
              AND COALESCE(variance_quantity, 0) <> 0
            ORDER BY id
        `, [req.params.id]);
        const adjustments = [];
        for (const line of lines.rows) {
            const quantityAfter = Number(line.expected_quantity || 0) + Number(line.variance_quantity || 0);
            const tx = await client.query(`
                INSERT INTO inventory_transactions
                  (transaction_type, transaction_status, product_id, lot_inventory_id, qr_unit_id,
                   lot_number, location_id, location_code, quantity_delta, quantity_after,
                   source_type, source_id, source_line_id, reason_code, comment, created_by)
                VALUES ('inventory_count_adjustment','posted',$1,$2,$3,$4,$5,$6,$7,$8,'inventory_count',$9,$10,$11,$12,$13)
                RETURNING *
            `, [line.product_id, line.lot_inventory_id, line.qr_unit_id, line.lot_number,
                line.location_id, line.location_code, line.variance_quantity, quantityAfter,
                req.params.id, line.id, value.reason_code || line.reason_code || 'inventory_count_variance',
                value.comment || line.comment || '棚卸差異調整', value.approved_by || 'inventory-counts-api']);

            await upsertBalance(client, {
                product_id: line.product_id,
                lot_inventory_id: line.lot_inventory_id,
                qr_unit_id: line.qr_unit_id,
                lot_number: line.lot_number,
                location_id: line.location_id,
                location_code: line.location_code,
                quantity_delta: line.variance_quantity,
                last_transaction_id: tx.rows[0].id
            });
            if (line.lot_inventory_id) {
                await client.query('UPDATE lot_inventory SET quantity = GREATEST(0, quantity + $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2', [line.variance_quantity, line.lot_inventory_id]);
            }
            if (line.qr_unit_id) {
                await client.query('UPDATE qr_units SET current_quantity = GREATEST(0, COALESCE(current_quantity, quantity) + $1), last_transaction_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [line.variance_quantity, tx.rows[0].id, line.qr_unit_id]);
            }
            const adjustment = await client.query(`
                INSERT INTO inventory_adjustments
                  (inventory_count_session_id, inventory_count_line_id, inventory_transaction_id,
                   product_id, lot_inventory_id, qr_unit_id, lot_number, qr_code, location_id,
                   location_code, expected_quantity, counted_quantity, adjustment_quantity,
                   reason_code, comment, approved_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                RETURNING *
            `, [req.params.id, line.id, tx.rows[0].id, line.product_id, line.lot_inventory_id,
                line.qr_unit_id, line.lot_number, line.qr_code, line.location_id, line.location_code,
                line.expected_quantity, line.counted_quantity, line.variance_quantity,
                value.reason_code || line.reason_code || 'inventory_count_variance',
                value.comment || line.comment || '棚卸差異調整', value.approved_by || null]);
            adjustments.push(adjustment.rows[0]);
        }

        const updated = await client.query(`
            UPDATE inventory_count_sessions
            SET status='approved', approved_at=CURRENT_TIMESTAMP, approved_by=$2, updated_at=CURRENT_TIMESTAMP
            WHERE id=$1
            RETURNING *
        `, [req.params.id, value.approved_by || null]);
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, reason_code, comment)
            VALUES ('inventory_count','inventory_count_approved','success','inventory_count',$1,$2::jsonb,$3,$4)
        `, [req.params.id, JSON.stringify({ adjustment_count: adjustments.length }), value.reason_code || null, value.comment || '棚卸を承認']);
        await client.query('COMMIT');
        res.json({ success: true, session: updated.rows[0], adjustments });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error approving inventory count:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
