/**
 * picking-instructions API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /picking-instructions と /api/picking-instructions
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
            picker_name: Joi.string().max(100).allow('', null),
            notes: Joi.string().allow('', null)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { shipping_instruction_id, picker_name, notes } = value;

        const siResult = await pool.query(
            'SELECT * FROM shipping_instructions WHERE id = $1', [shipping_instruction_id]
        );
        if (siResult.rows.length === 0) return res.status(404).json({ error: '出荷指示が見つかりません' });

        const si = siResult.rows[0];
        if (!['pending'].includes(si.status)) {
            return res.status(409).json({ error: `ステータス ${si.status} の指示にはピッキング指示を作成できません` });
        }

        const pickingId = `PICK-${si.instruction_id}-${Date.now().toString().slice(-4)}`;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`
                INSERT INTO picking_instructions
                  (picking_id, shipping_instruction_id, picker_name, total_quantity, notes)
                VALUES ($1,$2,$3,$4,$5) RETURNING *
            `, [pickingId, shipping_instruction_id, picker_name || null, si.quantity, notes || null]);
            await client.query(
                `UPDATE shipping_instructions SET status='picking', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [shipping_instruction_id]
            );
            await client.query('COMMIT');
            res.status(201).json(result.rows[0]);
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error creating picking instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング指示詳細（記録含む）
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const piResult = await pool.query(`
            SELECT pi.*, si.instruction_id, si.customer_name, si.quantity as ordered_qty,
                   p.product_code, p.product_name
            FROM picking_instructions pi
            JOIN shipping_instructions si ON pi.shipping_instruction_id = si.id
            JOIN products p ON si.product_id = p.id
            WHERE pi.id = $1
        `, [id]);
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Picking instruction not found' });

        const records = await pool.query(`
            SELECT pr.*, li.location as lot_location
            FROM picking_records pr
            LEFT JOIN lot_inventory li ON pr.lot_inventory_id = li.id
            WHERE pr.picking_instruction_id = $1
            ORDER BY pr.scanned_at
        `, [id]);

        res.json({ picking: piResult.rows[0], records: records.rows });
    } catch (error) {
        logger.error('Error fetching picking instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング開始（ステータス: pending → in_progress）
router.patch('/:id/start', async (req, res) => {
    try {
        const result = await pool.query(`
            UPDATE picking_instructions
            SET status='in_progress', started_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE id=$1 AND status='pending' RETURNING *
        `, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found or already started' });
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error starting picking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ロット QR スキャン（ピッキング記録）
router.post('/:id/scan', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = Joi.object({
            lot_number: Joi.string().max(50).required(),
            picked_quantity: Joi.number().integer().min(1).default(1)
        }).validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const { lot_number, picked_quantity } = value;

        // ピッキング指示取得
        const piResult = await pool.query(
            `SELECT pi.*, si.product_id FROM picking_instructions pi
             JOIN shipping_instructions si ON pi.shipping_instruction_id = si.id
             WHERE pi.id = $1`, [id]
        );
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Picking instruction not found' });
        const pi = piResult.rows[0];
        if (!['pending','in_progress'].includes(pi.status)) {
            return res.status(409).json({ error: `ステータス ${pi.status} のためスキャンできません` });
        }

        // ロット在庫確認
        const lotResult = await pool.query(
            `SELECT * FROM lot_inventory WHERE lot_number=$1 AND product_id=$2`,
            [lot_number, pi.product_id]
        );
        if (lotResult.rows.length === 0) {
            // エラー記録を保存
            await pool.query(`
                INSERT INTO picking_records (picking_instruction_id, lot_number, product_id, picked_quantity, status, error_message)
                VALUES ($1,$2,$3,$4,'error',$5)
            `, [id, lot_number, pi.product_id, picked_quantity, '対象製品のロットが見つかりません']);
            return res.json({ success: false, message: '対象製品のロットが見つかりません' });
        }

        const lot = lotResult.rows[0];
        if (lot.quantity < picked_quantity) {
            await pool.query(`
                INSERT INTO picking_records (picking_instruction_id, lot_number, product_id, picked_quantity, status, error_message)
                VALUES ($1,$2,$3,$4,'error',$5)
            `, [id, lot_number, pi.product_id, picked_quantity, `在庫不足 (在庫: ${lot.quantity})`]);
            return res.json({ success: false, message: `在庫不足です (在庫: ${lot.quantity})` });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // ピッキング記録
            const record = await client.query(`
                INSERT INTO picking_records (picking_instruction_id, lot_inventory_id, lot_number, product_id, picked_quantity, location)
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
            `, [id, lot.id, lot_number, pi.product_id, picked_quantity, lot.location]);

            // ピッキング済み数量を更新
            const newPicked = parseInt(pi.picked_quantity) + picked_quantity;
            await client.query(`
                UPDATE picking_instructions
                SET picked_quantity=$1, status='in_progress', updated_at=CURRENT_TIMESTAMP
                WHERE id=$2
            `, [newPicked, id]);

            await client.query('COMMIT');
            res.json({
                success: true,
                message: `ロット ${lot_number} をピッキングしました`,
                record: record.rows[0],
                picked_quantity: newPicked,
                total_quantity: pi.total_quantity
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error scanning lot for picking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング完了（出荷指示ステータス → packing）
router.patch('/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const piResult = await pool.query(
            'SELECT * FROM picking_instructions WHERE id=$1', [id]
        );
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const pi = piResult.rows[0];

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // ロット在庫を減算
            const records = await client.query(
                `SELECT lot_number, SUM(picked_quantity) as qty FROM picking_records
                 WHERE picking_instruction_id=$1 AND status='picked' GROUP BY lot_number`, [id]
            );
            for (const r of records.rows) {
                await client.query(
                    `UPDATE lot_inventory SET quantity = quantity - $1, updated_at=CURRENT_TIMESTAMP
                     WHERE lot_number=$2 AND quantity >= $1`,
                    [parseInt(r.qty), r.lot_number]
                );
            }
            await client.query(`
                UPDATE picking_instructions
                SET status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
                WHERE id=$1
            `, [id]);
            await client.query(
                `UPDATE shipping_instructions SET status='packing', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [pi.shipping_instruction_id]
            );
            await client.query('COMMIT');
            const updated = await pool.query('SELECT * FROM picking_instructions WHERE id=$1', [id]);
            res.json({ success: true, picking: updated.rows[0] });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        logger.error('Error completing picking:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 梱包 API ===

// 梱包記録作成（出荷指示ステータス packing で呼び出し）

module.exports = router;
