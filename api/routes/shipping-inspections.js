/**
 * shipping-inspections API ルーター(server.js から抽出、振る舞い不変。重複定義・順序も保持)
 * マウント: /shipping-inspections と /api/shipping-inspections
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { shipping_instruction_id } = req.query;
        let query = `
            SELECT shi.*, si.instruction_id, p.product_code, p.product_name
            FROM shipping_inspections shi
            JOIN shipping_instructions si ON shi.shipping_instruction_id = si.id
            JOIN products p ON si.product_id = p.id
        `;
        const params = [];

        if (shipping_instruction_id) {
            query += ' WHERE shi.shipping_instruction_id = $1';
            params.push(shipping_instruction_id);
        }

        query += ' ORDER BY shi.inspection_date DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping inspections:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 製品構成部品API ===

// 製品構成部品一覧取得（全件）
// product-components API はルーターへ分離(routes/product-components.js)

router.post('/', async (req, res) => {
    try {
        const { error, value } = shippingInspectionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            shipping_instruction_id,
            inspector_name,
            inspected_quantity,
            passed_quantity,
            failed_quantity,
            defect_details,
            packaging_condition,
            label_check,
            documentation_check,
            final_approval,
            notes
        } = value;

        const result = await pool.query(`
            INSERT INTO shipping_inspections (
                shipping_instruction_id, inspector_name, inspected_quantity,
                passed_quantity, failed_quantity, defect_details,
                packaging_condition, label_check, documentation_check,
                final_approval, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            shipping_instruction_id, inspector_name, inspected_quantity,
            passed_quantity, failed_quantity, defect_details,
            packaging_condition, label_check, documentation_check,
            final_approval, notes
        ]);

        // 最終承認の場合、出荷指示のステータスを更新
        if (final_approval && passed_quantity === inspected_quantity) {
            await pool.query(`
                UPDATE shipping_instructions 
                SET status = 'processing' 
                WHERE id = $1
            `, [shipping_instruction_id]);
        }

        logger.info('Shipping inspection created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping inspection:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === レポート関連API ===
// レポート API はルーターへ分離(routes/reports.js)

// === QC七つ道具API ===

// パレート図データ
// QC七つ道具 API はルーターへ分離(routes/qc-tools.js)
// inventory API はルーターへ分離(routes/inventory.js)

module.exports = router;
