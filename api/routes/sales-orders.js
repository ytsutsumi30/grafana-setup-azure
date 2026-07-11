const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

const salesOrderSchema = Joi.object({
    sales_order_no: Joi.string().max(50).required(),
    customer_name: Joi.string().max(255).required(),
    order_date: Joi.date().iso().allow(null),
    requested_ship_date: Joi.date().iso().allow(null),
    shipping_location_id: Joi.number().integer().allow(null),
    delivery_location_id: Joi.number().integer().allow(null),
    priority: Joi.string().valid('high', 'normal', 'low').default('normal'),
    status: Joi.string().max(30).default('confirmed'),
    notes: Joi.string().allow('', null),
    lines: Joi.array().items(Joi.object({
        product_id: Joi.number().integer().required(),
        ordered_quantity: Joi.number().integer().min(1).required(),
        notes: Joi.string().allow('', null)
    })).min(1).required()
});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT so.*,
                   sl.location_name AS shipping_location_name,
                   dl.location_name AS delivery_location_name,
                   COUNT(sol.id)::int AS line_count,
                   COALESCE(SUM(sol.ordered_quantity), 0)::int AS ordered_quantity,
                   COALESCE(SUM(sol.shipped_quantity), 0)::int AS shipped_quantity,
                   COUNT(si.id)::int AS shipping_instruction_count
            FROM sales_orders so
            LEFT JOIN shipping_locations sl ON sl.id = so.shipping_location_id
            LEFT JOIN delivery_locations dl ON dl.id = so.delivery_location_id
            LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
            LEFT JOIN shipping_instructions si ON si.sales_order_id = so.id
            GROUP BY so.id, sl.location_name, dl.location_name
            ORDER BY so.created_at DESC, so.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching sales orders:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const order = await pool.query(`
            SELECT so.*,
                   sl.location_name AS shipping_location_name,
                   dl.location_name AS delivery_location_name
            FROM sales_orders so
            LEFT JOIN shipping_locations sl ON sl.id = so.shipping_location_id
            LEFT JOIN delivery_locations dl ON dl.id = so.delivery_location_id
            WHERE so.id = $1
        `, [req.params.id]);
        if (order.rows.length === 0) return res.status(404).json({ error: 'Sales order not found' });
        const lines = await pool.query(`
            SELECT sol.*, p.product_code, p.product_name
            FROM sales_order_lines sol
            JOIN products p ON p.id = sol.product_id
            WHERE sol.sales_order_id = $1
            ORDER BY sol.id
        `, [req.params.id]);
        const shipping = await pool.query(`
            SELECT id, instruction_id, status, shipping_date, created_at
            FROM shipping_instructions
            WHERE sales_order_id = $1
            ORDER BY id
        `, [req.params.id]);
        res.json({ order: order.rows[0], lines: lines.rows, shipping_instructions: shipping.rows });
    } catch (error) {
        logger.error('Error fetching sales order:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = salesOrderSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        await client.query('BEGIN');
        const order = await client.query(`
            INSERT INTO sales_orders
              (sales_order_no, customer_name, order_date, requested_ship_date,
               shipping_location_id, delivery_location_id, priority, status, notes)
            VALUES ($1,$2,COALESCE($3::date, CURRENT_DATE),$4,$5,$6,$7,$8,$9)
            RETURNING *
        `, [
            value.sales_order_no, value.customer_name, value.order_date || null,
            value.requested_ship_date || null, value.shipping_location_id || null,
            value.delivery_location_id || null, value.priority || 'normal',
            value.status || 'confirmed', value.notes || null
        ]);

        const insertedLines = [];
        for (const line of value.lines) {
            const inserted = await client.query(`
                INSERT INTO sales_order_lines
                  (sales_order_id, product_id, ordered_quantity, status, notes)
                VALUES ($1,$2,$3,'confirmed',$4)
                RETURNING *
            `, [order.rows[0].id, line.product_id, line.ordered_quantity, line.notes || null]);
            insertedLines.push(inserted.rows[0]);
        }

        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('sales', 'sales_order_created', 'success', 'sales_order', $1, $2::jsonb, '受注を登録')
        `, [order.rows[0].id, JSON.stringify({ lines: insertedLines.length })]);
        await client.query('COMMIT');
        res.status(201).json({ order: order.rows[0], lines: insertedLines });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creating sales order:', error);
        if (error.code === '23505') return res.status(409).json({ error: '受注番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.post('/:id/create-shipping-instruction', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existing = await client.query(
            'SELECT * FROM shipping_instructions WHERE sales_order_id = $1 ORDER BY id DESC LIMIT 1',
            [req.params.id],
        );
        if (existing.rows.length > 0) {
            const lines = await client.query(`
                SELECT sil.*, p.product_code, p.product_name
                FROM shipping_instruction_lines sil
                JOIN products p ON p.id = sil.product_id
                WHERE sil.shipping_instruction_id = $1
                ORDER BY sil.id
            `, [existing.rows[0].id]);
            await client.query('COMMIT');
            return res.json({ shipping_instruction: existing.rows[0], lines: lines.rows, existing: true });
        }

        const orderResult = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (orderResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Sales order not found' });
        }
        const order = orderResult.rows[0];
        const orderLines = await client.query(`
            SELECT *
            FROM sales_order_lines
            WHERE sales_order_id = $1
            ORDER BY id
        `, [order.id]);
        if (orderLines.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '受注明細がありません' });
        }

        const firstLine = orderLines.rows[0];
        const totalQuantity = orderLines.rows.reduce((sum, line) => sum + Number(line.ordered_quantity || 0), 0);
        const instruction = await client.query(`
            INSERT INTO shipping_instructions
              (instruction_id, product_id, quantity, shipping_date, shipping_location_id,
               delivery_location_id, customer_name, priority, status, notes, sales_order_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)
            RETURNING *
        `, [
            `SHP-${order.sales_order_no}`, firstLine.product_id, totalQuantity,
            order.requested_ship_date, order.shipping_location_id, order.delivery_location_id,
            order.customer_name, order.priority, order.notes || '受注から出荷指示を生成', order.id
        ]);

        const shippingLines = [];
        for (const line of orderLines.rows) {
            const inserted = await client.query(`
                INSERT INTO shipping_instruction_lines
                  (shipping_instruction_id, product_id, quantity, shipped_quantity, status, sales_order_line_id)
                VALUES ($1,$2,$3,0,'pending',$4)
                RETURNING *
            `, [instruction.rows[0].id, line.product_id, line.ordered_quantity, line.id]);
            shippingLines.push(inserted.rows[0]);
        }

        await client.query(`
            UPDATE sales_orders
            SET status = 'planned', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [order.id]);
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('shipping', 'shipping_instruction_generated', 'success', 'sales_order', $1, $2::jsonb, '受注から出荷指示を生成')
        `, [order.id, JSON.stringify({ shipping_instruction_id: instruction.rows[0].id, line_count: shippingLines.length })]);
        await client.query('COMMIT');
        res.status(201).json({ shipping_instruction: instruction.rows[0], lines: shippingLines });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creating shipping instruction from sales order:', error);
        if (error.code === '23505') return res.status(409).json({ error: '出荷指示は既に作成済みです' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
