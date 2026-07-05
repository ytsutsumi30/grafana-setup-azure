/**
 * production-plans API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /production-plans と /api/production-plans
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { status } = req.query;

        let query = `
            SELECT pp.*, p.product_code, p.product_name
            FROM production_plans pp
            JOIN products p ON pp.product_id = p.id
        `;
        const params = [];

        if (status) {
            query += ' WHERE pp.status = $1';
            params.push(status);
        }

        query += ' ORDER BY pp.planned_start_date DESC, pp.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching production plans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画詳細取得
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT pp.*, p.product_code, p.product_name
            FROM production_plans pp
            JOIN products p ON pp.product_id = p.id
            WHERE pp.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Production plan not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching production plan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画登録
router.post('/', async (req, res) => {
    try {
        const {
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date,
            planned_end_date,
            status
        } = req.body;

        // バリデーション
        if (!plan_id || !product_id || !planned_quantity) {
            return res.status(400).json({
                error: 'Plan ID, product ID, and planned quantity are required'
            });
        }

        if (planned_quantity <= 0) {
            return res.status(400).json({
                error: 'Planned quantity must be greater than 0'
            });
        }

        // 日付の妥当性チェック
        if (planned_start_date && planned_end_date) {
            const startDate = new Date(planned_start_date);
            const endDate = new Date(planned_end_date);
            if (endDate < startDate) {
                return res.status(400).json({
                    error: 'End date must be after start date'
                });
            }
        }

        const result = await pool.query(`
            INSERT INTO production_plans
            (plan_id, product_id, planned_quantity, planned_start_date, planned_end_date, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date || null,
            planned_end_date || null,
            status || 'planned'
        ]);

        logger.info('Production plan created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating production plan:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Plan ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画更新
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date,
            planned_end_date,
            status
        } = req.body;

        // バリデーション
        if (!plan_id || !product_id || !planned_quantity) {
            return res.status(400).json({
                error: 'Plan ID, product ID, and planned quantity are required'
            });
        }

        if (planned_quantity <= 0) {
            return res.status(400).json({
                error: 'Planned quantity must be greater than 0'
            });
        }

        // 日付の妥当性チェック
        if (planned_start_date && planned_end_date) {
            const startDate = new Date(planned_start_date);
            const endDate = new Date(planned_end_date);
            if (endDate < startDate) {
                return res.status(400).json({
                    error: 'End date must be after start date'
                });
            }
        }

        const result = await pool.query(`
            UPDATE production_plans
            SET plan_id = $1, product_id = $2, planned_quantity = $3,
                planned_start_date = $4, planned_end_date = $5, status = $6,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $7
            RETURNING *
        `, [
            plan_id,
            product_id,
            planned_quantity,
            planned_start_date || null,
            planned_end_date || null,
            status || 'planned',
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Production plan not found' });
        }

        logger.info('Production plan updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating production plan:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Plan ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 生産計画削除
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 関連する生産実績の確認
        const relatedRecords = await pool.query(`
            SELECT COUNT(*) as count
            FROM production_records
            WHERE plan_id = $1
        `, [id]);

        const recordCount = parseInt(relatedRecords.rows[0].count);

        if (recordCount > 0) {
            return res.status(409).json({
                error: '関連する生産実績が存在するため削除できません',
                production_records: recordCount
            });
        }

        const result = await pool.query(
            'DELETE FROM production_plans WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Production plan not found' });
        }

        logger.info('Production plan deleted:', result.rows[0]);
        res.json({ message: 'Production plan deleted successfully' });
    } catch (error) {
        logger.error('Error deleting production plan:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: production plan is referenced by other records' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 出荷場所・納入場所API ===

module.exports = router;
