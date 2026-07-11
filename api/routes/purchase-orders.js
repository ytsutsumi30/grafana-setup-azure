const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

const purchaseOrderSchema = Joi.object({
    purchase_order_no: Joi.string().max(50).required(),
    supplier_id: Joi.number().integer().required(),
    order_date: Joi.date().iso().allow(null),
    expected_date: Joi.date().iso().allow(null),
    status: Joi.string().max(30).default('ordered'),
    notes: Joi.string().allow('', null),
    lines: Joi.array().items(Joi.object({
        product_id: Joi.number().integer().required(),
        ordered_quantity: Joi.number().integer().min(1).required(),
        unit_price: Joi.number().min(0).allow(null),
        expected_date: Joi.date().iso().allow(null),
        notes: Joi.string().allow('', null)
    })).min(1).required()
});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT po.*, s.supplier_code, s.supplier_name,
                   COUNT(pol.id)::int AS line_count,
                   COALESCE(SUM(pol.ordered_quantity), 0)::int AS ordered_quantity,
                   COALESCE(SUM(pol.received_quantity), 0)::int AS received_quantity
            FROM purchase_orders po
            JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
            GROUP BY po.id, s.supplier_code, s.supplier_name
            ORDER BY po.created_at DESC, po.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching purchase orders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const order = await pool.query(`
            SELECT po.*, s.supplier_code, s.supplier_name
            FROM purchase_orders po
            JOIN suppliers s ON s.id = po.supplier_id
            WHERE po.id = $1
        `, [req.params.id]);
        if (order.rows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });
        const lines = await pool.query(`
            SELECT pol.*, p.product_code, p.product_name
            FROM purchase_order_lines pol
            JOIN products p ON p.id = pol.product_id
            WHERE pol.purchase_order_id = $1
            ORDER BY pol.id
        `, [req.params.id]);
        res.json({ order: order.rows[0], lines: lines.rows });
    } catch (error) {
        logger.error('Error fetching purchase order:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = purchaseOrderSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
        await client.query('BEGIN');
        const order = await client.query(`
            INSERT INTO purchase_orders (purchase_order_no, supplier_id, order_date, expected_date, status, notes)
            VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6)
            RETURNING *
        `, [value.purchase_order_no, value.supplier_id, value.order_date || null, value.expected_date || null, value.status || 'ordered', value.notes || null]);
        const insertedLines = [];
        for (const line of value.lines) {
            const lineResult = await client.query(`
                INSERT INTO purchase_order_lines
                  (purchase_order_id, product_id, ordered_quantity, unit_price, expected_date, status, notes)
                VALUES ($1,$2,$3,$4,$5,'ordered',$6)
                RETURNING *
            `, [order.rows[0].id, line.product_id, line.ordered_quantity, line.unit_price || null, line.expected_date || value.expected_date || null, line.notes || null]);
            insertedLines.push(lineResult.rows[0]);
        }
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('purchase', 'purchase_order_created', 'success', 'purchase_order', $1, $2::jsonb, '発注を登録')
        `, [order.rows[0].id, JSON.stringify({ lines: insertedLines.length })]);
        await client.query('COMMIT');
        res.status(201).json({ order: order.rows[0], lines: insertedLines });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creating purchase order:', error);
        if (error.code === '23505') return res.status(409).json({ error: '発注番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.post('/:id/create-receiving-order', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT * FROM receiving_orders WHERE purchase_order_id = $1 ORDER BY id DESC LIMIT 1', [req.params.id]);
        if (existing.rows.length > 0) {
            const lines = await client.query('SELECT * FROM receiving_order_lines WHERE receiving_order_id = $1 ORDER BY id', [existing.rows[0].id]);
            await client.query('COMMIT');
            return res.json({ receiving_order: existing.rows[0], lines: lines.rows, existing: true });
        }
        const poResult = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
        if (poResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Purchase order not found' });
        }
        const po = poResult.rows[0];
        const receiving = await client.query(`
            INSERT INTO receiving_orders (receiving_order_no, purchase_order_id, supplier_id, expected_date, status, notes)
            VALUES ($1,$2,$3,$4,'pending','発注から入庫予定を生成')
            RETURNING *
        `, [`RCV-${po.purchase_order_no}`, po.id, po.supplier_id, po.expected_date]);
        const poLines = await client.query('SELECT * FROM purchase_order_lines WHERE purchase_order_id = $1 ORDER BY id', [po.id]);
        const receivingLines = [];
        for (const line of poLines.rows) {
            const remaining = Number(line.ordered_quantity || 0) - Number(line.received_quantity || 0);
            if (remaining <= 0) continue;
            const inserted = await client.query(`
                INSERT INTO receiving_order_lines
                  (receiving_order_id, purchase_order_line_id, product_id, expected_quantity, status)
                VALUES ($1,$2,$3,$4,'pending')
                RETURNING *
            `, [receiving.rows[0].id, line.id, line.product_id, remaining]);
            receivingLines.push(inserted.rows[0]);
        }
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('receiving', 'receiving_order_generated', 'success', 'purchase_order', $1, $2::jsonb, '発注から入庫予定を生成')
        `, [po.id, JSON.stringify({ receiving_order_id: receiving.rows[0].id, line_count: receivingLines.length })]);
        await client.query('COMMIT');
        res.status(201).json({ receiving_order: receiving.rows[0], lines: receivingLines });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creating receiving order:', error);
        if (error.code === '23505') return res.status(409).json({ error: '入庫予定は既に作成済みです' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
