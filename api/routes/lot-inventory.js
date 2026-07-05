/**
 * lot-inventory API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /lot-inventory と /api/lot-inventory
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const Joi = require('joi');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { product_id, status, lot_number } = req.query;
        let query = `
            SELECT li.*, p.product_code, p.product_name
            FROM lot_inventory li
            JOIN products p ON li.product_id = p.id
            WHERE 1=1
        `;
        const params = [];
        if (product_id) { params.push(product_id); query += ` AND li.product_id = $${params.length}`; }
        if (status)     { params.push(status);     query += ` AND li.status = $${params.length}`; }
        if (lot_number) { params.push(`%${lot_number}%`); query += ` AND li.lot_number ILIKE $${params.length}`; }
        query += ' ORDER BY li.product_id, li.lot_number';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching lot inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品別ロット在庫取得
router.get('/by-product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(`
            SELECT li.*, p.product_code, p.product_name
            FROM lot_inventory li
            JOIN products p ON li.product_id = p.id
            WHERE li.product_id = $1
            ORDER BY li.lot_number
        `, [productId]);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching lot inventory by product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット在庫詳細取得
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT li.*, p.product_code, p.product_name
            FROM lot_inventory li
            JOIN products p ON li.product_id = p.id
            WHERE li.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Lot not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching lot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット在庫登録
router.post('/', async (req, res) => {
    try {
        const { error, value } = Joi.object({
            product_id: Joi.number().integer().required(),
            lot_number: Joi.string().max(50).required(),
            quantity: Joi.number().integer().min(0).required(),
            manufacturing_date: Joi.date().iso().allow(null),
            expiry_date: Joi.date().iso().allow(null),
            location: Joi.string().max(100).allow('', null),
            notes: Joi.string().allow('', null)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const result = await pool.query(`
            INSERT INTO lot_inventory (product_id, lot_number, quantity, manufacturing_date, expiry_date, location, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
        `, [value.product_id, value.lot_number, value.quantity, value.manufacturing_date || null,
            value.expiry_date || null, value.location || null, value.notes || null]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating lot:', error);
        if (error.code === '23505') return res.status(409).json({ error: '同一製品・ロット番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット在庫更新（入庫・調整）
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { quantity, status, location, notes } = req.body;
        const result = await pool.query(`
            UPDATE lot_inventory
            SET quantity = COALESCE($1, quantity),
                status   = COALESCE($2, status),
                location = COALESCE($3, location),
                notes    = COALESCE($4, notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 RETURNING *
        `, [quantity, status, location, notes, id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Lot not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating lot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === ピッキング API ===

// ピッキング指示作成（出荷指示を picking ステータスへ）

module.exports = router;
