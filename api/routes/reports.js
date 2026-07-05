/**
 * レポート API ルーター
 * server.js から抽出(振る舞いは不変)。/reports 配下にマウントされる。
 */
const express = require('express');
const router = express.Router();
const pool = require('../lib/db');
const logger = require('../lib/logger');

router.get('/shipping-summary', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM shipping_inspection_summary
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/dashboard-stats', async (req, res) => {
    try {
        const [
            shippingStats,
            inspectionStats,
            inventoryStats
        ] = await Promise.all([
            pool.query(`
                SELECT
                    status,
                    COUNT(*) as count
                FROM shipping_instructions
                GROUP BY status
            `),
            pool.query(`
                SELECT
                    COUNT(*) as total_inspections,
                    SUM(CASE WHEN final_approval THEN 1 ELSE 0 END) as approved_inspections,
                    AVG(passed_quantity::float / NULLIF(inspected_quantity, 0) * 100) as pass_rate
                FROM shipping_inspections
                WHERE inspection_date >= CURRENT_DATE - INTERVAL '30 days'
            `),
            pool.query(`
                SELECT
                    COUNT(*) as total_products,
                    SUM(current_stock) as total_stock,
                    SUM(available_stock) as available_stock
                FROM inventory
            `)
        ]);

        res.json({
            shipping: shippingStats.rows,
            inspection: inspectionStats.rows[0],
            inventory: inventoryStats.rows[0]
        });
    } catch (error) {
        logger.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 本日の検品実績統計
router.get('/daily-inspection-stats', async (req, res) => {
    try {
        // 検品完了・失敗のカウントはqr_inspectionsから取得
        const inspectionResult = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status = 'completed' AND DATE(completed_at) = CURRENT_DATE) as completed_today,
                COUNT(*) FILTER (WHERE status = 'failed' AND DATE(completed_at) = CURRENT_DATE) as failed_today
            FROM qr_inspections
        `);

        // 待機中のカウントはshipping_instructionsから取得（検品待ち出荷指示一覧と一致させる）
        const pendingResult = await pool.query(`
            SELECT COUNT(*) as in_progress
            FROM shipping_instructions
            WHERE status = 'pending'
        `);

        const inspectionStats = inspectionResult.rows[0];
        const pendingStats = pendingResult.rows[0];

        // 合格率の計算
        const completedToday = parseInt(inspectionStats.completed_today) || 0;
        const failedToday = parseInt(inspectionStats.failed_today) || 0;
        const totalInspections = completedToday + failedToday;
        const passRateToday = totalInspections > 0 ? (completedToday * 100.0 / totalInspections) : 0;

        const result = {
            rows: [{
                completed_today: completedToday,
                in_progress: parseInt(pendingStats.in_progress) || 0,
                failed_today: failedToday,
                pass_rate_today: passRateToday
            }]
        };

        const stats = result.rows[0];

        res.json({
            completed_today: parseInt(stats.completed_today) || 0,
            in_progress: parseInt(stats.in_progress) || 0,
            failed_today: parseInt(stats.failed_today) || 0,
            pass_rate_today: parseFloat(stats.pass_rate_today) || 0
        });
    } catch (error) {
        logger.error('Error fetching daily inspection stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 最近の検品履歴
router.get('/recent-inspections', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;

        const result = await pool.query(`
            SELECT
                qi.id,
                qi.inspector_name,
                qi.status,
                qi.completed_at,
                qi.created_at,
                si.instruction_id,
                p.product_name
            FROM qr_inspections qi
            LEFT JOIN shipping_instructions si ON qi.shipping_instruction_id = si.id
            LEFT JOIN products p ON qi.product_id = p.id
            WHERE qi.status IN ('completed', 'failed')
            ORDER BY COALESCE(qi.completed_at, qi.created_at) DESC
            LIMIT $1
        `, [limit]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching recent inspections:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
