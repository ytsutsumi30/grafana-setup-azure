/**
 * products API ルーター(server.js から抽出、振る舞い不変。重複定義・順序も保持)
 * マウント: /products と /api/products
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.*, i.current_stock, i.available_stock 
            FROM products p 
            LEFT JOIN inventory i ON p.id = i.product_id 
            ORDER BY p.product_code
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品詳細取得

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT p.*, i.current_stock, i.available_stock, i.location 
            FROM products p 
            LEFT JOIN inventory i ON p.id = i.product_id 
            WHERE p.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品登録

router.post('/', async (req, res) => {
    try {
        const { error, value } = productSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { product_code, product_name, description, unit_price, category } = value;

        // 製品コードの重複チェック
        const existingProduct = await pool.query(
            'SELECT id FROM products WHERE product_code = $1',
            [product_code]
        );

        if (existingProduct.rows.length > 0) {
            return res.status(409).json({ error: '製品コードが既に存在します' });
        }

        // トランザクション開始
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 製品を登録
            const productResult = await client.query(`
                INSERT INTO products (product_code, product_name, description, unit_price, category)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `, [product_code, product_name, description, unit_price, category]);

            const newProduct = productResult.rows[0];

            // 在庫レコードを初期化
            await client.query(`
                INSERT INTO inventory (product_id, current_stock, reserved_stock)
                VALUES ($1, 0, 0)
            `, [newProduct.id]);

            await client.query('COMMIT');

            logger.info('Product created:', newProduct);
            res.status(201).json(newProduct);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error creating product:', error);
        if (error.code === '23505') { // Unique violation
            res.status(409).json({ error: '製品コードが既に存在します' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// 製品更新

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = productSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const { product_code, product_name, description, unit_price, category } = value;

        // 製品コードの重複チェック（自分以外）
        const existingProduct = await pool.query(
            'SELECT id FROM products WHERE product_code = $1 AND id != $2',
            [product_code, id]
        );

        if (existingProduct.rows.length > 0) {
            return res.status(409).json({ error: '製品コードが既に存在します' });
        }

        const result = await pool.query(`
            UPDATE products 
            SET product_code = $1,
                product_name = $2,
                description = $3,
                unit_price = $4,
                category = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
            RETURNING *
        `, [product_code, product_name, description, unit_price, category, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        logger.info('Product updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating product:', error);
        if (error.code === '23505') { // Unique violation
            res.status(409).json({ error: '製品コードが既に存在します' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

// 製品削除

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 削除前にリレーションチェック
        const relatedRecords = await pool.query(`
            SELECT 
                (SELECT COUNT(*) FROM production_plans WHERE product_id = $1) as production_plans,
                (SELECT COUNT(*) FROM production_records WHERE product_id = $1) as production_records,
                (SELECT COUNT(*) FROM shipping_instructions WHERE product_id = $1) as shipping_instructions,
                (SELECT COUNT(*) FROM product_components WHERE product_id = $1) as product_components
        `, [id]);

        const relations = relatedRecords.rows[0];
        const hasRelations = Object.values(relations).some(count => parseInt(count) > 0);

        if (hasRelations) {
            return res.status(409).json({
                error: '関連データが存在するため削除できません',
                relations: relations
            });
        }

        // トランザクション開始
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 在庫レコードを削除
            await client.query('DELETE FROM inventory WHERE product_id = $1', [id]);

            // 製品を削除
            const result = await client.query(
                'DELETE FROM products WHERE id = $1 RETURNING *',
                [id]
            );

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Product not found' });
            }

            await client.query('COMMIT');

            logger.info('Product deleted:', result.rows[0]);
            res.json({ message: 'Product deleted successfully', data: result.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error deleting product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 生産計画API ===

// 生産計画一覧取得
// production-plans API はルーターへ分離(routes/production-plans.js)
// shipping-locations API はルーターへ分離(routes/shipping-locations.js)
// delivery-locations API はルーターへ分離(routes/delivery-locations.js)

router.get('/:productId/components', async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name
            FROM product_components pc
            JOIN products p ON pc.product_id = p.id
            WHERE pc.product_id = $1
            ORDER BY 
                CASE pc.component_type 
                    WHEN 'main' THEN 1 
                    WHEN 'accessory' THEN 2 
                    WHEN 'manual' THEN 3 
                    WHEN 'warranty' THEN 4 
                    ELSE 5 
                END, pc.component_name
        `, [productId]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching product components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示IDから製品同梱物取得

module.exports = router;
