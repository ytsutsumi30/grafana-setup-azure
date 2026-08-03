/**
 * inventory API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /inventory と /api/inventory
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/balances', async (req, res) => {
    try {
        const { product_id, lot_number, location_code, inventory_status } = req.query;
        const params = [];
        const conditions = [];
        if (product_id) {
            params.push(product_id);
            conditions.push(`ib.product_id = $${params.length}`);
        }
        if (lot_number) {
            params.push(`%${lot_number}%`);
            conditions.push(`ib.lot_number ILIKE $${params.length}`);
        }
        if (location_code) {
            params.push(location_code);
            conditions.push(`ib.location_code = $${params.length}`);
        }
        if (inventory_status) {
            params.push(inventory_status);
            conditions.push(`ib.inventory_status = $${params.length}`);
        }
        // ロット集約残高が作られた後はそれを物理在庫の正とし、内訳QR残高との二重計上を避ける。
        conditions.push(`NOT (
            ib.qr_unit_id IS NOT NULL
            AND EXISTS (
                SELECT 1
                FROM inventory_balances aggregate_balance
                WHERE aggregate_balance.product_id = ib.product_id
                  AND COALESCE(aggregate_balance.lot_number, '') = COALESCE(ib.lot_number, '')
                  AND COALESCE(aggregate_balance.location_code, '') = COALESCE(ib.location_code, '')
                  AND aggregate_balance.inventory_status = ib.inventory_status
                  AND aggregate_balance.qr_unit_id IS NULL
            )
        )`);
        const where = `WHERE ${conditions.join(' AND ')}`;
        const result = await pool.query(`
            SELECT ib.*,
                   p.product_code,
                   p.product_name,
                   qu.qr_code,
                   loc.location_name
            FROM inventory_balances ib
            JOIN products p ON p.id = ib.product_id
            LEFT JOIN qr_units qu ON qu.id = ib.qr_unit_id
            LEFT JOIN locations loc ON loc.id = ib.location_id
            ${where}
            ORDER BY p.product_code, ib.lot_number NULLS LAST, ib.location_code NULLS LAST, ib.inventory_status
        `, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory balances:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/transactions', async (req, res) => {
    try {
        const { product_id, lot_number, source_type, transaction_type } = req.query;
        const params = [];
        const conditions = [];
        if (product_id) {
            params.push(product_id);
            conditions.push(`it.product_id = $${params.length}`);
        }
        if (lot_number) {
            params.push(`%${lot_number}%`);
            conditions.push(`it.lot_number ILIKE $${params.length}`);
        }
        if (source_type) {
            params.push(source_type);
            conditions.push(`it.source_type = $${params.length}`);
        }
        if (transaction_type) {
            params.push(transaction_type);
            conditions.push(`it.transaction_type = $${params.length}`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(`
            SELECT it.*,
                   p.product_code,
                   p.product_name,
                   qu.qr_code,
                   loc.location_name
            FROM inventory_transactions it
            JOIN products p ON p.id = it.product_id
            LEFT JOIN qr_units qu ON qu.id = it.qr_unit_id
            LEFT JOIN locations loc ON loc.id = it.location_id
            ${where}
            ORDER BY it.occurred_at DESC, it.id DESC
            LIMIT 200
        `, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT i.*, p.product_code, p.product_name, p.category
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            ORDER BY p.product_code
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 在庫詳細取得
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT i.*, p.product_code, p.product_name, p.category
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inventory record not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 在庫調整（現在庫・引当在庫の更新）
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { current_stock, reserved_stock, location } = req.body;

        // 少なくとも1つのフィールドが必要
        if (current_stock === undefined && reserved_stock === undefined && location === undefined) {
            return res.status(400).json({
                error: 'At least one field (current_stock, reserved_stock, or location) must be provided'
            });
        }

        // 負の値チェック
        if ((current_stock !== undefined && current_stock < 0) ||
            (reserved_stock !== undefined && reserved_stock < 0)) {
            return res.status(400).json({
                error: 'Stock values cannot be negative'
            });
        }

        // 動的にUPDATE文を構築
        const updates = [];
        const values = [];
        let paramIndex = 1;

        if (current_stock !== undefined) {
            updates.push(`current_stock = $${paramIndex++}`);
            values.push(current_stock);
        }
        if (reserved_stock !== undefined) {
            updates.push(`reserved_stock = $${paramIndex++}`);
            values.push(reserved_stock);
        }
        if (location !== undefined) {
            updates.push(`location = $${paramIndex++}`);
            values.push(location);
        }
        updates.push(`last_updated = CURRENT_TIMESTAMP`);
        values.push(id);

        const query = `
            UPDATE inventory
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inventory record not found' });
        }

        logger.info('Inventory updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品IDで在庫取得
router.get('/by-product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(`
            SELECT i.*, p.product_code, p.product_name, p.category
            FROM inventory i
            JOIN products p ON i.product_id = p.id
            WHERE i.product_id = $1
        `, [productId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Inventory record not found for this product' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching inventory by product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === データベース管理API ===

// データベース統計情報取得

module.exports = router;
