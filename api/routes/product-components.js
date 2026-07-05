/**
 * product-components API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /product-components と /api/product-components
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name
            FROM product_components pc
            JOIN products p ON pc.product_id = p.id
            ORDER BY p.product_code,
                CASE pc.component_type
                    WHEN 'main' THEN 1
                    WHEN 'accessory' THEN 2
                    WHEN 'manual' THEN 3
                    WHEN 'warranty' THEN 4
                    ELSE 5
                END, pc.component_name
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching product components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品詳細取得
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name
            FROM product_components pc
            JOIN products p ON pc.product_id = p.id
            WHERE pc.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product component not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching product component:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品登録
router.post('/', async (req, res) => {
    try {
        const { product_id, component_type, component_name, qr_code, is_required } = req.body;

        // バリデーション
        if (!product_id || !component_type || !component_name || !qr_code) {
            return res.status(400).json({
                error: 'Product ID, component type, name, and QR code are required'
            });
        }

        const result = await pool.query(`
            INSERT INTO product_components
            (product_id, component_type, component_name, qr_code, is_required)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [product_id, component_type, component_name, qr_code, is_required !== false]);

        logger.info('Product component created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating product component:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'QR code already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Product not found' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品更新
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { product_id, component_type, component_name, qr_code, is_required } = req.body;

        // バリデーション
        if (!product_id || !component_type || !component_name || !qr_code) {
            return res.status(400).json({
                error: 'Product ID, component type, name, and QR code are required'
            });
        }

        const result = await pool.query(`
            UPDATE product_components
            SET product_id = $1, component_type = $2, component_name = $3,
                qr_code = $4, is_required = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `, [product_id, component_type, component_name, qr_code, is_required !== false, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product component not found' });
        }

        logger.info('Product component updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating product component:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'QR code already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Product not found' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品構成部品削除
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM product_components WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product component not found' });
        }

        logger.info('Product component deleted:', result.rows[0]);
        res.json({ message: 'Product component deleted successfully' });
    } catch (error) {
        logger.error('Error deleting product component:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: component is referenced by inspection records' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === QR検品関連API ===

// 製品の同梱物一覧取得

module.exports = router;
