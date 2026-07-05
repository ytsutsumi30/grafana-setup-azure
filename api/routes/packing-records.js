/**
 * packing-records API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /packing-records と /api/packing-records
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const Joi = require('joi');

const router = express.Router();

router.post('/', async (req, res) => {
    try {
        const { error, value } = Joi.object({
            shipping_instruction_id: Joi.number().integer().required(),
            picking_instruction_id: Joi.number().integer().allow(null),
            packer_name: Joi.string().max(100).allow('', null),
            packed_quantity: Joi.number().integer().min(0).default(0),
            box_count: Joi.number().integer().min(1).default(1),
            total_weight_kg: Joi.number().min(0).allow(null),
            packaging_type: Joi.string().max(50).allow('', null),
            lot_numbers: Joi.string().allow('', null),
            notes: Joi.string().allow('', null)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const result = await pool.query(`
            INSERT INTO packing_records
              (shipping_instruction_id, picking_instruction_id, packer_name, packed_quantity,
               box_count, total_weight_kg, packaging_type, lot_numbers, notes, status, started_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'in_progress',CURRENT_TIMESTAMP) RETURNING *
        `, [value.shipping_instruction_id, value.picking_instruction_id || null, value.packer_name || null,
            value.packed_quantity, value.box_count, value.total_weight_kg || null,
            value.packaging_type || null, value.lot_numbers || null, value.notes || null]);

        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating packing record:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 梱包記録詳細取得
router.get('/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT pr.*, si.instruction_id, si.customer_name, p.product_code, p.product_name
            FROM packing_records pr
            JOIN shipping_instructions si ON pr.shipping_instruction_id = si.id
            JOIN products p ON si.product_id = p.id
            WHERE pr.id = $1
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Packing record not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching packing record:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 梱包記録更新
router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { packer_name, packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes } = req.body;
        const result = await pool.query(`
            UPDATE packing_records
            SET packer_name      = COALESCE($1, packer_name),
                packed_quantity  = COALESCE($2, packed_quantity),
                box_count        = COALESCE($3, box_count),
                total_weight_kg  = COALESCE($4, total_weight_kg),
                packaging_type   = COALESCE($5, packaging_type),
                lot_numbers      = COALESCE($6, lot_numbers),
                notes            = COALESCE($7, notes),
                updated_at       = CURRENT_TIMESTAMP
            WHERE id = $8 RETURNING *
        `, [packer_name, packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes, id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Packing record not found' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating packing record:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 梱包完了（出荷指示ステータス → inspecting）
router.patch('/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes } = req.body;

        const prResult = await pool.query('SELECT * FROM packing_records WHERE id=$1', [id]);
        if (prResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const pr = prResult.rows[0];

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`
                UPDATE packing_records
                SET status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP,
                    packed_quantity  = COALESCE($1, packed_quantity),
                    box_count        = COALESCE($2, box_count),
                    total_weight_kg  = COALESCE($3, total_weight_kg),
                    packaging_type   = COALESCE($4, packaging_type),
                    lot_numbers      = COALESCE($5, lot_numbers),
                    notes            = COALESCE($6, notes)
                WHERE id = $7
            `, [packed_quantity, box_count, total_weight_kg, packaging_type, lot_numbers, notes, id]);
            await client.query(
                `UPDATE shipping_instructions SET status='inspecting', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [pr.shipping_instruction_id]
            );
            await client.query('COMMIT');
            const updated = await pool.query('SELECT * FROM packing_records WHERE id=$1', [id]);
            res.json({ success: true, packing: updated.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error completing packing:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示に紐づくPPS進捗一括取得

module.exports = router;
