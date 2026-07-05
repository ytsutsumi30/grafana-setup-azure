/**
 * モニタリング API ルーター(server.js から抽出、振る舞い不変)
 * requireAdmin を注入して generate-sample-data を保護する。
 * マウント: /monitoring と /api/monitoring
 */
const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');

module.exports = function (requireAdmin) {
  const router = express.Router();

router.get('/shipment-realtime', async (req, res) => {
    try {
        const result = await pool.query(`
            WITH today_inspections AS (
                SELECT
                    COUNT(*) as total_today,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_today,
                    SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_today,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_today,
                    AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60) FILTER (WHERE completed_at IS NOT NULL) as avg_time
                FROM qr_inspections
                WHERE DATE(created_at) = CURRENT_DATE
            ),
            hourly_trend AS (
                SELECT
                    EXTRACT(HOUR FROM created_at) as hour,
                    COUNT(*) as count
                FROM qr_inspections
                WHERE DATE(created_at) = CURRENT_DATE
                GROUP BY EXTRACT(HOUR FROM created_at)
                ORDER BY hour
            ),
            queue_status AS (
                SELECT COUNT(*) as waiting_count
                FROM shipping_instructions
                WHERE shipment_status = 'pending'
            )
            SELECT
                ti.*,
                qs.waiting_count,
                COALESCE(
                    (SELECT JSON_AGG(JSON_BUILD_OBJECT('hour', hour, 'count', count) ORDER BY hour)
                     FROM hourly_trend),
                    '[]'::json
                ) as hourly_data
            FROM today_inspections ti, queue_status qs
        `);

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipment realtime data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 時間帯別出荷推移（過去7日間）
router.get('/shipment-trend', async (req, res) => {
    try {
        const { days = 7 } = req.query;

        const result = await pool.query(`
            SELECT
                DATE(created_at) as date,
                EXTRACT(HOUR FROM created_at) as hour,
                COUNT(*) as inspection_count,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
            FROM qr_inspections
            WHERE created_at > CURRENT_DATE - INTERVAL '${parseInt(days)} days'
            GROUP BY DATE(created_at), EXTRACT(HOUR FROM created_at)
            ORDER BY date DESC, hour
        `);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipment trend:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 製品別出荷実績（トップN）
router.get('/product-shipment-ranking', async (req, res) => {
    try {
        const { period = 30, limit = 10 } = req.query;

        const result = await pool.query(`
            SELECT
                p.id,
                p.product_name,
                p.product_code,
                COUNT(qi.id) as shipment_count,
                SUM(qi.passed_quantity) as total_quantity,
                ROUND(AVG(EXTRACT(EPOCH FROM (qi.completed_at - qi.created_at)) / 60)::NUMERIC, 2) as avg_inspection_time,
                SUM(CASE WHEN qi.status = 'failed' THEN 1 ELSE 0 END) as failed_count
            FROM products p
            LEFT JOIN qr_inspections qi ON p.id = qi.product_id
            WHERE qi.created_at > CURRENT_DATE - INTERVAL '${parseInt(period)} days'
            GROUP BY p.id, p.product_name, p.product_code
            ORDER BY shipment_count DESC
            LIMIT $1
        `, [parseInt(limit)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching product shipment ranking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 検品員別パフォーマンス分析 ---

// 検品員パフォーマンスサマリー
router.get('/inspector-performance', async (req, res) => {
    try {
        const { period = 7 } = req.query;

        const result = await pool.query(`
            SELECT
                inspector_name,
                COUNT(*) as total_inspections,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
                ROUND((SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::NUMERIC /
                       NULLIF(COUNT(*), 0) * 100), 2) as success_rate,
                ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)::NUMERIC, 2) as avg_inspection_time,
                SUM(scanned_components) as total_components,
                ROUND((SUM(scanned_components)::NUMERIC / NULLIF(COUNT(*), 0)), 1) as avg_components_per_inspection,
                MIN(created_at) as first_inspection,
                MAX(completed_at) as last_inspection
            FROM qr_inspections
            WHERE created_at > CURRENT_DATE - INTERVAL '${parseInt(period)} days'
              AND inspector_name IS NOT NULL
            GROUP BY inspector_name
            ORDER BY total_inspections DESC
        `);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inspector performance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 検品員別時間帯パフォーマンス
router.get('/inspector-hourly-performance', async (req, res) => {
    try {
        const { inspector_name } = req.query;

        let query = `
            SELECT
                inspector_name,
                EXTRACT(HOUR FROM created_at) as hour,
                COUNT(*) as inspection_count,
                ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60)::NUMERIC, 2) as avg_time
            FROM qr_inspections
            WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
              AND inspector_name IS NOT NULL
        `;

        const params = [];
        if (inspector_name) {
            params.push(inspector_name);
            query += ` AND inspector_name = $1`;
        }

        query += ` GROUP BY inspector_name, EXTRACT(HOUR FROM created_at) ORDER BY inspector_name, hour`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inspector hourly performance:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 在庫健全性KPI ---

// 在庫健全性ダッシュボード
router.get('/inventory-health', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                product_id,
                product_name,
                product_code,
                current_stock,
                reserved_stock,
                available_stock,
                avg_daily_demand,
                demand_volatility,
                days_of_stock,
                turnover_rate,
                health_status
            FROM v_inventory_health
            ORDER BY
                CASE health_status
                    WHEN 'critical' THEN 1
                    WHEN 'warning' THEN 2
                    WHEN 'overstocked' THEN 3
                    ELSE 4
                END,
                days_of_stock NULLS LAST
        `);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory health:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 在庫回転率ランキング
router.get('/inventory-turnover', async (req, res) => {
    try {
        const { limit = 20, order = 'desc' } = req.query;

        const result = await pool.query(`
            SELECT
                product_id,
                product_name,
                product_code,
                current_stock,
                available_stock,
                turnover_rate,
                health_status
            FROM v_inventory_health
            WHERE turnover_rate IS NOT NULL
            ORDER BY turnover_rate ${order === 'asc' ? 'ASC' : 'DESC'}
            LIMIT $1
        `, [parseInt(limit)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching inventory turnover:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// デッドストック検出（90日以上未出荷）
router.get('/dead-stock', async (req, res) => {
    try {
        const { days = 90 } = req.query;

        const result = await pool.query(`
            WITH last_shipment AS (
                SELECT
                    product_id,
                    MAX(completed_at) as last_shipment_date,
                    COUNT(*) as total_shipments
                FROM qr_inspections
                WHERE status = 'completed'
                GROUP BY product_id
            )
            SELECT
                p.id as product_id,
                p.product_name,
                p.product_code,
                i.current_stock,
                i.available_stock,
                ls.last_shipment_date,
                CURRENT_DATE - DATE(ls.last_shipment_date) as days_since_shipment,
                ls.total_shipments
            FROM products p
            LEFT JOIN inventory i ON p.id = i.product_id
            LEFT JOIN last_shipment ls ON p.id = ls.product_id
            WHERE (ls.last_shipment_date IS NULL OR
                   CURRENT_DATE - DATE(ls.last_shipment_date) > $1)
              AND i.available_stock > 0
            ORDER BY days_since_shipment DESC NULLS FIRST
        `, [parseInt(days)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching dead stock:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 欠品リスクアラート ---

// 欠品リスク製品リスト
router.get('/stockout-risk', async (req, res) => {
    try {
        const { threshold = 7 } = req.query;  // デフォルト7日分以下

        const result = await pool.query(`
            SELECT
                product_id,
                product_name,
                product_code,
                current_stock,
                reserved_stock,
                available_stock,
                avg_daily_demand,
                days_of_stock,
                health_status,
                CASE
                    WHEN days_of_stock < 3 THEN 'critical'
                    WHEN days_of_stock < 7 THEN 'high'
                    WHEN days_of_stock < 14 THEN 'medium'
                    ELSE 'low'
                END as risk_level
            FROM v_inventory_health
            WHERE days_of_stock IS NOT NULL
              AND days_of_stock < $1
            ORDER BY days_of_stock ASC
        `, [parseInt(threshold)]);

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching stockout risk:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// アラート作成
router.post('/alerts', async (req, res) => {
    try {
        const schema = Joi.object({
            alert_type: Joi.string().required(),
            severity: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
            product_id: Joi.number().integer(),
            alert_message: Joi.string().required(),
            alert_data: Joi.object(),
            expires_at: Joi.date()
        });

        const { error, value } = schema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const result = await pool.query(`
            INSERT INTO monitoring_alerts
            (alert_type, severity, product_id, alert_message, alert_data, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [
            value.alert_type,
            value.severity,
            value.product_id || null,
            value.alert_message,
            JSON.stringify(value.alert_data || {}),
            value.expires_at || null
        ]);

        logger.info(`Alert created: ${value.alert_type} - ${value.severity}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating alert:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// アクティブアラート一覧
router.get('/alerts', async (req, res) => {
    try {
        const { severity, alert_type, acknowledged } = req.query;

        let query = `
            SELECT *
            FROM monitoring_alerts
            WHERE (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        `;

        const params = [];
        let paramIndex = 1;

        if (severity) {
            params.push(severity);
            query += ` AND severity = $${paramIndex++}`;
        }

        if (alert_type) {
            params.push(alert_type);
            query += ` AND alert_type = $${paramIndex++}`;
        }

        if (acknowledged !== undefined) {
            params.push(acknowledged === 'true');
            query += ` AND is_acknowledged = $${paramIndex++}`;
        }

        query += ` ORDER BY severity DESC, created_at DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching alerts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// アラート確認
router.patch('/alerts/:id/acknowledge', async (req, res) => {
    try {
        const { id } = req.params;
        const { acknowledged_by } = req.body;

        const result = await pool.query(`
            UPDATE monitoring_alerts
            SET is_acknowledged = TRUE,
                acknowledged_by = $1,
                acknowledged_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [acknowledged_by || 'system', id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Alert not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error acknowledging alert:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- 統合ダッシュボードサマリー ---

// モニタリングダッシュボード総合サマリー
router.get('/dashboard-summary', async (req, res) => {
    try {
        const [shipmentData, inventoryData, alertData, performanceData] = await Promise.all([
            // 出荷状況
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as today_total,
                    COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE AND status = 'completed') as today_completed,
                    COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress
                FROM qr_inspections
            `),
            // 在庫状況
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE health_status = 'critical') as critical_count,
                    COUNT(*) FILTER (WHERE health_status = 'warning') as warning_count,
                    COUNT(*) FILTER (WHERE health_status = 'overstocked') as overstocked_count,
                    ROUND(AVG(turnover_rate)::NUMERIC, 2) as avg_turnover_rate
                FROM v_inventory_health
            `),
            // アラート状況
            pool.query(`
                SELECT
                    COUNT(*) FILTER (WHERE NOT is_acknowledged AND severity = 'critical') as critical_alerts,
                    COUNT(*) FILTER (WHERE NOT is_acknowledged AND severity = 'high') as high_alerts,
                    COUNT(*) FILTER (WHERE NOT is_acknowledged) as total_unacknowledged
                FROM monitoring_alerts
                WHERE expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP
            `),
            // 検品員パフォーマンス
            pool.query(`
                SELECT
                    COUNT(DISTINCT inspector_name) as active_inspectors,
                    ROUND(AVG(success_rate)::NUMERIC, 2) as avg_success_rate
                FROM v_inspector_performance
            `)
        ]);

        res.json({
            shipment: shipmentData.rows[0],
            inventory: inventoryData.rows[0],
            alerts: alertData.rows[0],
            performance: performanceData.rows[0],
            generated_at: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Error fetching dashboard summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// サンプルデータ生成エンドポイント
router.post('/generate-sample-data', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. 既存のモニタリングデータをクリア
        await client.query('DELETE FROM inventory_snapshots');
        await client.query('DELETE FROM inspection_performance_hourly');
        await client.query('DELETE FROM monitoring_alerts WHERE is_acknowledged = FALSE');

        // 2. 製品データを取得
        const productsResult = await client.query('SELECT id, product_name FROM products LIMIT 10');
        const products = productsResult.rows;

        if (products.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No products found. Please add products first.' });
        }

        // 3. 在庫スナップショットデータ生成（過去30日分）
        const inventorySnapshots = [];
        for (let dayOffset = 30; dayOffset >= 0; dayOffset--) {
            const snapshotDate = new Date();
            snapshotDate.setDate(snapshotDate.getDate() - dayOffset);
            const dateStr = snapshotDate.toISOString().split('T')[0];

            for (const product of products) {
                const baseStock = 100 + Math.floor(Math.random() * 500);
                const dailyShipments = 5 + Math.floor(Math.random() * 30);
                const dailyReceipts = dayOffset % 7 === 0 ? 50 + Math.floor(Math.random() * 100) : 0;
                const quantityOnHand = baseStock + (30 - dayOffset) * 5;
                const quantityReserved = Math.floor(Math.random() * 50);
                const quantityAvailable = quantityOnHand - quantityReserved;
                const turnoverRate = (dailyShipments / Math.max(quantityAvailable, 1) * 30).toFixed(4);
                const daysOfStock = (quantityAvailable / Math.max(dailyShipments, 1)).toFixed(2);

                inventorySnapshots.push({
                    date: dateStr,
                    product_id: product.id,
                    quantity_on_hand: quantityOnHand,
                    quantity_reserved: quantityReserved,
                    quantity_available: quantityAvailable,
                    daily_shipments: dailyShipments,
                    daily_receipts: dailyReceipts,
                    turnover_rate: turnoverRate,
                    days_of_stock: daysOfStock
                });
            }
        }

        // 在庫スナップショット一括挿入
        for (const snapshot of inventorySnapshots) {
            await client.query(`
                INSERT INTO inventory_snapshots
                (snapshot_date, product_id, quantity_on_hand, quantity_reserved,
                 quantity_available, daily_shipments, daily_receipts, turnover_rate, days_of_stock)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                snapshot.date, snapshot.product_id, snapshot.quantity_on_hand,
                snapshot.quantity_reserved, snapshot.quantity_available,
                snapshot.daily_shipments, snapshot.daily_receipts,
                snapshot.turnover_rate, snapshot.days_of_stock
            ]);
        }

        // 4. 検品パフォーマンスデータ生成（過去7日分、8時間/日）
        const inspectors = ['田中太郎', '佐藤花子', '鈴木一郎', '高橋美咲'];
        const performanceData = [];

        for (let dayOffset = 7; dayOffset >= 0; dayOffset--) {
            for (let hour = 9; hour <= 16; hour++) {
                const timestamp = new Date();
                timestamp.setDate(timestamp.getDate() - dayOffset);
                timestamp.setHours(hour, 0, 0, 0);

                for (const inspector of inspectors) {
                    const totalInspections = 2 + Math.floor(Math.random() * 8);
                    const completedInspections = totalInspections - Math.floor(Math.random() * 2);
                    const failedInspections = totalInspections - completedInspections;
                    const avgInspectionTime = (5 + Math.random() * 15).toFixed(2);
                    const totalComponents = totalInspections * (3 + Math.floor(Math.random() * 5));

                    performanceData.push({
                        timestamp: timestamp.toISOString(),
                        inspector: inspector,
                        total: totalInspections,
                        completed: completedInspections,
                        failed: failedInspections,
                        avg_time: avgInspectionTime,
                        components: totalComponents
                    });
                }
            }
        }

        // 検品パフォーマンス一括挿入
        for (const perf of performanceData) {
            await client.query(`
                INSERT INTO inspection_performance_hourly
                (hour_timestamp, inspector_name, total_inspections, completed_inspections,
                 failed_inspections, avg_inspection_time, total_components_scanned)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                perf.timestamp, perf.inspector, perf.total, perf.completed,
                perf.failed, perf.avg_time, perf.components
            ]);
        }

        // 5. モニタリングアラート生成
        const alertTypes = [
            { type: 'stockout_risk', severity: 'high', message: '在庫不足リスク: 7日以内に在庫切れの可能性' },
            { type: 'stockout_risk', severity: 'critical', message: '在庫不足警告: 3日以内に在庫切れの可能性' },
            { type: 'quality_degradation', severity: 'medium', message: '品質低下検出: 不良率が通常の1.5倍に上昇' },
            { type: 'performance_drop', severity: 'medium', message: '検品速度低下: 平均検品時間が20%増加' },
            { type: 'overstocked', severity: 'low', message: '過剰在庫警告: 90日分以上の在庫保有' }
        ];

        // 製品の一部にアラートを設定（3-5件）
        const alertCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < alertCount; i++) {
            const alert = alertTypes[i % alertTypes.length];
            const randomProduct = products[Math.floor(Math.random() * products.length)];
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            await client.query(`
                INSERT INTO monitoring_alerts
                (alert_type, severity, product_id, alert_message, alert_data, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                alert.type,
                alert.severity,
                randomProduct.id,
                `${randomProduct.product_name}: ${alert.message}`,
                JSON.stringify({ product_name: randomProduct.product_name }),
                expiresAt.toISOString()
            ]);
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'モニタリングサンプルデータを生成しました',
            data: {
                inventory_snapshots: inventorySnapshots.length,
                performance_records: performanceData.length,
                alerts: alertCount,
                products_used: products.length
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error generating monitoring sample data:', error);
        res.status(500).json({ error: 'Failed to generate sample data', details: error.message });
    } finally {
        client.release();
    }
});

// === データベース バックアップ・復元 API ===

// データベース全体のバックアップSQLを生成

  return router;
};
