/**
 * QC七つ道具 API ルーター(server.js から抽出、振る舞い不変)
 * requireAdmin を注入して generate-sample-data を保護する。
 * マウント: /qc-tools と /api/qc-tools
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

module.exports = function (requireAdmin) {
  const router = express.Router();

router.get('/pareto', async (req, res) => {
    try {
        const period = req.query.period || 'week';
        let dateFilter = "DATE(qi.completed_at) >= CURRENT_DATE - INTERVAL '7 days'";

        if (period === 'today') {
            dateFilter = "DATE(qi.completed_at) = CURRENT_DATE";
        } else if (period === 'month') {
            dateFilter = "DATE(qi.completed_at) >= CURRENT_DATE - INTERVAL '30 days'";
        } else if (period === 'quarter') {
            dateFilter = "DATE(qi.completed_at) >= CURRENT_DATE - INTERVAL '90 days'";
        }

        // 不良原因別の集計（qr_inspection_detailsのステータスがerrorのものを集計）
        const result = await pool.query(`
            SELECT
                COALESCE(qid.error_message, '未分類') as category,
                COUNT(*) as count
            FROM qr_inspection_details qid
            JOIN qr_inspections qi ON qid.qr_inspection_id = qi.id
            WHERE qid.status = 'error' AND ${dateFilter}
            GROUP BY COALESCE(qid.error_message, '未分類')
            ORDER BY count DESC
        `);

        const categories = result.rows.map(r => r.category);
        const counts = result.rows.map(r => parseInt(r.count));
        const total = counts.reduce((a, b) => a + b, 0);

        // 累積比率の計算
        let cumulative = [];
        let sum = 0;
        for (let count of counts) {
            sum += count;
            cumulative.push((sum / total * 100).toFixed(1));
        }

        // 統計情報
        const top3Sum = counts.slice(0, 3).reduce((a, b) => a + b, 0);
        const top3Percentage = total > 0 ? ((top3Sum / total) * 100).toFixed(1) : 0;

        // 80%ラインまでの項目数
        let items80 = 0;
        let running = 0;
        for (let count of counts) {
            running += count;
            items80++;
            if ((running / total) >= 0.8) break;
        }

        // 推奨アクション
        const recommendations = [];
        if (top3Percentage > 70) {
            recommendations.push(`上位3項目で${top3Percentage}%を占めています。重点的に対策してください。`);
        }
        if (items80 <= 3) {
            recommendations.push(`80%の不良が${items80}項目に集中しています。優先的に改善を実施してください。`);
        }

        res.json({
            categories,
            counts,
            cumulative: cumulative.map(parseFloat),
            total,
            top3_percentage: parseFloat(top3Percentage),
            items_to_80: items80,
            recommendations
        });
    } catch (error) {
        logger.error('Error fetching pareto data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 管理図データ
router.get('/control-chart', async (req, res) => {
    try {
        const metric = req.query.metric || 'defect_rate';

        // 過去30日のデータを取得
        const result = await pool.query(`
            SELECT
                DATE(qi.completed_at) as date,
                COUNT(*) as total_inspections,
                SUM(CASE WHEN qi.status = 'failed' THEN 1 ELSE 0 END) as failed_count
            FROM qr_inspections qi
            WHERE qi.completed_at >= CURRENT_DATE - INTERVAL '30 days'
                AND qi.status IN ('completed', 'failed')
            GROUP BY DATE(qi.completed_at)
            ORDER BY date
        `);

        const dates = result.rows.map(r => r.date);
        const values = result.rows.map(r => {
            const total = parseInt(r.total_inspections);
            const failed = parseInt(r.failed_count);
            return total > 0 ? ((failed / total) * 100).toFixed(2) : 0;
        }).map(parseFloat);

        // 管理限界の計算（平均 ± 3σ）
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        const std = Math.sqrt(variance);

        const ucl = mean + 3 * std; // 上方管理限界
        const cl = mean;             // 中心線
        const lcl = Math.max(0, mean - 3 * std); // 下方管理限界（0以下にならない）

        // 管理外点の検出
        const alerts = [];
        let inControl = true;
        values.forEach((val, idx) => {
            if (val > ucl || val < lcl) {
                alerts.push(`${dates[idx]}: 管理限界外 (${val.toFixed(2)}%)`);
                inControl = false;
            }
        });

        res.json({
            dates,
            values,
            ucl,
            cl,
            lcl,
            in_control: inControl,
            alerts
        });
    } catch (error) {
        logger.error('Error fetching control chart data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ヒストグラムデータ
router.get('/histogram', async (req, res) => {
    try {
        const metric = req.query.metric || 'inspection_time';

        // サンプルデータ生成（実際にはqr_inspectionsから取得）
        const result = await pool.query(`
            SELECT
                EXTRACT(EPOCH FROM (qi.completed_at - qi.created_at))/60 as inspection_time_minutes
            FROM qr_inspections qi
            WHERE qi.status = 'completed'
                AND qi.completed_at IS NOT NULL
                AND qi.created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);

        const data = result.rows.map(r => parseFloat(r.inspection_time_minutes));

        // ヒストグラムのビン（階級）を作成
        const min = Math.min(...data);
        const max = Math.max(...data);
        const binCount = 10;
        const binWidth = (max - min) / binCount;

        const bins = [];
        const frequencies = new Array(binCount).fill(0);

        for (let i = 0; i < binCount; i++) {
            const binStart = min + i * binWidth;
            const binEnd = min + (i + 1) * binWidth;
            bins.push(`${binStart.toFixed(1)}-${binEnd.toFixed(1)}`);

            // 度数をカウント
            frequencies[i] = data.filter(val => val >= binStart && val < binEnd).length;
        }

        // 統計量の計算
        const mean = data.reduce((a, b) => a + b, 0) / data.length;
        const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
        const std = Math.sqrt(variance);
        const range = max - min;

        res.json({
            bins,
            frequencies,
            mean,
            std,
            range
        });
    } catch (error) {
        logger.error('Error fetching histogram data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 散布図データ
router.get('/scatter', async (req, res) => {
    try {
        const xMetric = req.query.x || 'inspection_time';
        const yMetric = req.query.y || 'defect_rate';

        const result = await pool.query(`
            SELECT
                EXTRACT(EPOCH FROM (qi.completed_at - qi.created_at))/60 as inspection_time,
                qi.total_components as total_components,
                qi.scanned_components as scanned_components,
                CASE
                    WHEN qi.total_components > 0
                    THEN ((qi.total_components - qi.scanned_components)::float / qi.total_components * 100)
                    ELSE 0
                END as defect_rate
            FROM qr_inspections qi
            WHERE qi.status = 'completed'
                AND qi.completed_at IS NOT NULL
                AND qi.created_at >= CURRENT_DATE - INTERVAL '30 days'
        `);

        const points = result.rows.map(r => ({
            x: parseFloat(r.inspection_time) || 0,
            y: parseFloat(r.defect_rate) || 0
        }));

        // 相関係数の計算
        const xValues = points.map(p => p.x);
        const yValues = points.map(p => p.y);
        const correlation = calculateCorrelation(xValues, yValues);

        res.json({
            points,
            correlation
        });
    } catch (error) {
        logger.error('Error fetching scatter data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// チェックシートデータ
router.get('/checksheet', async (req, res) => {
    try {
        // 週次の検査項目別チェック数
        const result = await pool.query(`
            SELECT
                pc.component_type,
                EXTRACT(DOW FROM qid.scanned_at) as day_of_week,
                COUNT(*) as check_count
            FROM qr_inspection_details qid
            JOIN product_components pc ON qid.product_component_id = pc.id
            WHERE qid.scanned_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY pc.component_type, EXTRACT(DOW FROM qid.scanned_at)
            ORDER BY pc.component_type, day_of_week
        `);

        // 検査項目ごとに曜日別集計を作成
        const itemsMap = new Map();

        result.rows.forEach(row => {
            const type = row.component_type;
            if (!itemsMap.has(type)) {
                itemsMap.set(type, {
                    name: type,
                    daily_counts: new Array(7).fill(0),
                    total: 0
                });
            }

            const dayIndex = parseInt(row.day_of_week); // 0=日, 1=月, ..., 6=土
            const count = parseInt(row.check_count);
            itemsMap.get(type).daily_counts[dayIndex] = count;
            itemsMap.get(type).total += count;
        });

        const items = Array.from(itemsMap.values());
        const totalChecks = items.reduce((sum, item) => sum + item.total, 0);

        res.json({
            items,
            total_items: items.length,
            total_checks: totalChecks
        });
    } catch (error) {
        logger.error('Error fetching checksheet data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 相関係数計算ヘルパー関数
function calculateCorrelation(x, y) {
    const n = x.length;
    if (n === 0) return 0;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
}

// QCツール用サンプルデータ生成
router.post('/generate-sample-data', requireAdmin, async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 既存のサンプルデータを削除
        await client.query(`
            DELETE FROM qr_inspection_details WHERE qr_inspection_id IN (
                SELECT id FROM qr_inspections WHERE inspector_name LIKE 'サンプル%'
            )
        `);
        await client.query(`DELETE FROM qr_inspections WHERE inspector_name LIKE 'サンプル%'`);

        const errorMessages = [
            '部品欠品',
            '外観不良',
            '数量不一致',
            'QRコード読み取り不可',
            '梱包不良',
            '製品破損',
            'ラベル貼付不良',
            '仕様違い'
        ];

        let totalInspections = 0;
        let totalDetails = 0;

        // 過去30日分のデータを生成
        for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
            const inspectionsPerDay = 3 + Math.floor(Math.random() * 7); // 3〜10件/日

            for (let i = 0; i < inspectionsPerDay; i++) {
                // ランダムに製品と出荷指示を選択
                const productResult = await client.query('SELECT id FROM products ORDER BY RANDOM() LIMIT 1');
                const shippingResult = await client.query('SELECT id FROM shipping_instructions ORDER BY RANDOM() LIMIT 1');

                if (productResult.rows.length === 0 || shippingResult.rows.length === 0) {
                    continue;
                }

                const productId = productResult.rows[0].id;
                const shippingInstructionId = shippingResult.rows[0].id;

                // 検品時間をランダムに生成（5〜30分）
                const inspectionMinutes = 5 + Math.floor(Math.random() * 25);

                // 失敗か成功かをランダムに決定（10%の確率で失敗）
                const isFailed = Math.random() < 0.1;

                // 製品の総部品数を取得
                const componentsResult = await client.query(
                    'SELECT COUNT(*) as count FROM product_components WHERE product_id = $1',
                    [productId]
                );

                let totalComponents = parseInt(componentsResult.rows[0].count) || 3;
                if (totalComponents === 0) totalComponents = 3;

                // スキャンした部品数（失敗の場合は少なめ）
                const scannedComponents = isFailed
                    ? totalComponents - (1 + Math.floor(Math.random() * 2))
                    : totalComponents;

                // 基準日時を計算
                const baseDate = new Date();
                baseDate.setDate(baseDate.getDate() - dayOffset);
                baseDate.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);

                const completedDate = new Date(baseDate.getTime() + inspectionMinutes * 60000);

                // QR検品レコードを挿入
                const inspectionResult = await client.query(`
                    INSERT INTO qr_inspections (
                        shipping_instruction_id,
                        inspector_name,
                        product_id,
                        total_components,
                        scanned_components,
                        passed_quantity,
                        status,
                        created_at,
                        completed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    RETURNING id
                `, [
                    shippingInstructionId,
                    'サンプル検品員' + (1 + Math.floor(Math.random() * 5)),
                    productId,
                    totalComponents,
                    scannedComponents,
                    isFailed ? 0 : 1,
                    isFailed ? 'failed' : 'completed',
                    baseDate,
                    completedDate
                ]);

                const inspectionId = inspectionResult.rows[0].id;
                totalInspections++;

                // 部品を取得
                const componentsListResult = await client.query(
                    'SELECT id FROM product_components WHERE product_id = $1 LIMIT $2',
                    [productId, totalComponents]
                );

                // 検品詳細データを挿入
                for (let j = 0; j < totalComponents; j++) {
                    const componentId = componentsListResult.rows[j]?.id || componentsListResult.rows[0]?.id;

                    if (!componentId) continue;

                    const scanDate = new Date(baseDate.getTime() + j * 30000); // 30秒間隔

                    // 失敗検品の場合、一部をエラーとして記録
                    if (isFailed && j >= scannedComponents) {
                        const errorMsg = errorMessages[Math.floor(Math.random() * errorMessages.length)];

                        await client.query(`
                            INSERT INTO qr_inspection_details (
                                qr_inspection_id,
                                product_component_id,
                                qr_code,
                                status,
                                error_message,
                                scanned_at
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `, [
                            inspectionId,
                            componentId,
                            'QR-ERROR-' + j,
                            'error',
                            errorMsg,
                            scanDate
                        ]);
                    } else {
                        // 正常スキャン
                        await client.query(`
                            INSERT INTO qr_inspection_details (
                                qr_inspection_id,
                                product_component_id,
                                qr_code,
                                status,
                                scanned_at
                            ) VALUES ($1, $2, $3, $4, $5)
                        `, [
                            inspectionId,
                            componentId,
                            'QR-OK-' + j,
                            'scanned',
                            scanDate
                        ]);
                    }

                    totalDetails++;
                }
            }
        }

        await client.query('COMMIT');

        logger.info(`Sample data generated: ${totalInspections} inspections, ${totalDetails} details`);

        res.json({
            success: true,
            message: 'サンプルデータの生成が完了しました',
            total_inspections: totalInspections,
            total_details: totalDetails
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error generating sample data:', error);
        res.status(500).json({ error: 'サンプルデータの生成に失敗しました: ' + error.message });
    } finally {
        client.release();
    }
});

// === 在庫管理API ===

// 在庫一覧取得

  return router;
};
