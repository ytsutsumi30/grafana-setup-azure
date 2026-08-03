/**
 * qr-inspections API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /qr-inspections と /api/qr-inspections
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const systemConfig = require('../lib/config');

const router = express.Router();

router.post('/', async (req, res) => {
    try {
        const { shipping_instruction_id, inspector_name } = req.body;

        if (!shipping_instruction_id || !inspector_name) {
            return res.status(400).json({ error: 'shipping_instruction_id and inspector_name are required' });
        }

        // 出荷指示と製品情報を取得
        const shippingResult = await pool.query(`
            SELECT si.*, p.id as product_id, i.current_stock
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE si.id = $1
        `, [shipping_instruction_id]);

        if (shippingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        const shippingInstruction = shippingResult.rows[0];

        // 同梱物数を取得
        const componentsResult = await pool.query(`
            SELECT COUNT(*) as total_components
            FROM product_components
            WHERE product_id = $1 AND is_required = true
        `, [shippingInstruction.product_id]);

        const totalComponents = parseInt(componentsResult.rows[0].total_components);

        // QR検品記録を作成
        const result = await pool.query(`
            INSERT INTO qr_inspections (
                shipping_instruction_id, inspector_name, product_id,
                total_components, current_stock_before
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [
            shipping_instruction_id, inspector_name, shippingInstruction.product_id,
            totalComponents, shippingInstruction.current_stock
        ]);

        logger.info('QR inspection started:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error starting QR inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QRコードスキャン記録
router.post('/:id/scan', async (req, res) => {
    try {
        const { id } = req.params;
        const { qr_code } = req.body;

        if (!qr_code) {
            return res.status(400).json({ error: 'qr_code is required' });
        }

        // QR検品記録を取得
        const inspectionResult = await pool.query(`
            SELECT * FROM qr_inspections WHERE id = $1 AND status = 'in_progress'
        `, [id]);

        if (inspectionResult.rows.length === 0) {
            return res.status(404).json({ error: 'QR inspection not found or already completed' });
        }

        const inspection = inspectionResult.rows[0];

        // 製品同梱物をチェック
        const componentResult = await pool.query(`
            SELECT * FROM product_components 
            WHERE product_id = $1 AND qr_code = $2
        `, [inspection.product_id, qr_code]);

        if (componentResult.rows.length === 0) {
            // 不正なQRコード
            const errorResult = await pool.query(`
                INSERT INTO qr_inspection_details (
                    qr_inspection_id, qr_code, status, error_message
                ) VALUES ($1, $2, 'error', 'Invalid QR code for this product')
                RETURNING *
            `, [id, qr_code]);

            return res.status(400).json({
                success: false,
                message: '対象外のQRコードです',
                data: errorResult.rows[0]
            });
        }

        const component = componentResult.rows[0];

        // POCモードチェック: DB書き込みが無効の場合
        if (systemConfig.pocMode && !systemConfig.enableQRInspectionDB) {
            logger.info(`[POC Mode] QR scan skipped DB write: ${qr_code}`);

            // DB書き込みなしでも成功レスポンスを返す
            return res.json({
                success: true,
                message: 'スキャン成功 (POCモード: DB書き込みなし)',
                component: component,
                pocMode: true
            });
        }

        // 既にスキャン済みかチェック
        const existingResult = await pool.query(`
            SELECT * FROM qr_inspection_details 
            WHERE qr_inspection_id = $1 AND product_component_id = $2 AND status = 'scanned'
        `, [id, component.id]);

        if (existingResult.rows.length > 0) {
            // 重複スキャン
            return res.status(400).json({
                success: false,
                message: '既にスキャン済みです',
                component: component
            });
        }

        // スキャン記録を追加
        const scanResult = await pool.query(`
            INSERT INTO qr_inspection_details (
                qr_inspection_id, product_component_id, qr_code, status
            ) VALUES ($1, $2, $3, 'scanned')
            RETURNING *
        `, [id, component.id, qr_code]);

        // スキャン済み数を更新
        await pool.query(`
            UPDATE qr_inspections 
            SET scanned_components = (
                SELECT COUNT(*) FROM qr_inspection_details 
                WHERE qr_inspection_id = $1 AND status = 'scanned'
            ),
            updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [id]);

        res.json({
            success: true,
            message: 'スキャン成功',
            component: component,
            data: scanResult.rows[0]
        });
    } catch (error) {
        logger.error('Error processing QR scan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品完了
router.patch('/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        // POCモードチェック: DB書き込みが無効の場合
        if (systemConfig.pocMode && !systemConfig.enableQRInspectionDB) {
            logger.info(`[POC Mode] QR inspection complete skipped DB write: ${id}`);

            // DB書き込みなしで成功レスポンスを返す
            return res.json({
                id: id,
                status: 'completed',
                passed_quantity: 0,
                notes: notes || '検品完了 (POCモード: DB書き込みなし)',
                completed_at: new Date().toISOString(),
                pocMode: true,
                message: '検品完了しました（POCモード）'
            });
        }

        // QR検品記録を取得
        const inspectionResult = await pool.query(`
            SELECT qi.*, si.quantity 
            FROM qr_inspections qi
            JOIN shipping_instructions si ON qi.shipping_instruction_id = si.id
            WHERE qi.id = $1 AND qi.status = 'in_progress'
        `, [id]);

        if (inspectionResult.rows.length === 0) {
            return res.status(404).json({ error: 'QR inspection not found or already completed' });
        }

        const inspection = inspectionResult.rows[0];

        // 全同梱物がスキャン済みかチェック
        const isComplete = inspection.scanned_components >= inspection.total_components;
        const status = isComplete ? 'completed' : 'failed';
        const passedQuantity = isComplete ? inspection.quantity : 0;

        // 在庫控除はロット引当確定、または互換ピッキング完了時に一度だけ行う。
        let newStock = inspection.current_stock_before;

        // QR検品記録を完了
        const result = await pool.query(`
            UPDATE qr_inspections 
            SET status = $1,
                passed_quantity = $2,
                current_stock_after = $3,
                notes = $4,
                completed_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING *
        `, [status, passedQuantity, newStock, notes, id]);

        // 検品完了の場合、出荷指示のステータスも更新
        if (isComplete) {
            await pool.query(`
                UPDATE shipping_instructions 
                SET status = 'processing',
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [inspection.shipping_instruction_id]);
        }

        logger.info('QR inspection completed:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error completing QR inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品詳細取得
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // QR検品記録を取得
        const inspectionResult = await pool.query(`
            SELECT qi.*, si.instruction_id, si.quantity, p.product_code, p.product_name
            FROM qr_inspections qi
            JOIN shipping_instructions si ON qi.shipping_instruction_id = si.id
            JOIN products p ON qi.product_id = p.id
            WHERE qi.id = $1
        `, [id]);

        if (inspectionResult.rows.length === 0) {
            return res.status(404).json({ error: 'QR inspection not found' });
        }

        // 検品詳細を取得
        const detailsResult = await pool.query(`
            SELECT qid.*, pc.component_name, pc.component_type, pc.qr_code as expected_qr_code
            FROM qr_inspection_details qid
            LEFT JOIN product_components pc ON qid.product_component_id = pc.id
            WHERE qid.qr_inspection_id = $1
            ORDER BY qid.scanned_at DESC
        `, [id]);

        res.json({
            inspection: inspectionResult.rows[0],
            details: detailsResult.rows
        });
    } catch (error) {
        logger.error('Error fetching QR inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品用統合データ取得（出荷指示詳細+製品構成部品+在庫情報）

module.exports = router;
