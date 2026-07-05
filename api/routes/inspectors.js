/**
 * inspectors API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /inspectors と /api/inspectors
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const Joi = require('joi');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { is_active } = req.query;

        let query = 'SELECT * FROM inspectors';
        const params = [];

        if (is_active !== undefined) {
            query += ' WHERE is_active = $1';
            params.push(is_active === 'true');
        }

        query += ' ORDER BY inspector_code';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inspectors:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者詳細取得
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM inspectors WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inspector not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching inspector:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者登録バリデーションスキーマ
const inspectorSchema = Joi.object({
    inspector_code: Joi.string().max(20).required(),
    inspector_name: Joi.string().max(100).required(),
    email: Joi.string().email().max(255).allow('', null),
    phone: Joi.string().max(20).allow('', null),
    department: Joi.string().max(100).allow('', null),
    role: Joi.string().valid('inspector', 'supervisor', 'admin').default('inspector'),
    is_active: Joi.boolean().default(true)
});

// 検品者登録
router.post('/', async (req, res) => {
    try {
        const { error, value } = inspectorSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            inspector_code,
            inspector_name,
            email,
            phone,
            department,
            role,
            is_active
        } = value;

        const result = await pool.query(`
            INSERT INTO inspectors (
                inspector_code, inspector_name, email, phone, department, role, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [inspector_code, inspector_name, email, phone, department, role, is_active]);

        logger.info('Inspector created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating inspector:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Inspector code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者更新
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = inspectorSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            inspector_code,
            inspector_name,
            email,
            phone,
            department,
            role,
            is_active
        } = value;

        const result = await pool.query(`
            UPDATE inspectors
            SET inspector_code = $1,
                inspector_name = $2,
                email = $3,
                phone = $4,
                department = $5,
                role = $6,
                is_active = $7,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $8
            RETURNING *
        `, [inspector_code, inspector_name, email, phone, department, role, is_active, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inspector not found' });
        }

        logger.info('Inspector updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating inspector:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Inspector code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品者削除
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM inspectors WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inspector not found' });
        }

        logger.info('Inspector deleted:', result.rows[0]);
        res.json({ message: 'Inspector deleted successfully', inspector: result.rows[0] });
    } catch (error) {
        logger.error('Error deleting inspector:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 出荷指示 CRUD API ===

// 出荷指示作成バリデーションスキーマ
const shippingInstructionSchema = Joi.object({
    instruction_id: Joi.string().max(50).required(),
    product_id: Joi.number().required(),
    quantity: Joi.number().min(1).required(),
    shipping_date: Joi.date().required(),
    shipping_location_id: Joi.number().required(),
    delivery_location_id: Joi.number().required(),
    customer_name: Joi.string().max(255).allow(''),
    priority: Joi.string().valid('high', 'normal', 'low').default('normal'),
    status: Joi.string().valid('pending', 'processing', 'shipped', 'delivered').default('pending'),
    tracking_number: Joi.string().max(100).allow(''),
    notes: Joi.string().allow('')
});

// 出荷指示作成

module.exports = router;
