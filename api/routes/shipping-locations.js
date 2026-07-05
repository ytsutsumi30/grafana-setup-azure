/**
 * shipping-locations API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /shipping-locations と /api/shipping-locations
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM shipping_locations 
            ORDER BY location_code
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping locations:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所詳細取得
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM shipping_locations WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping location not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipping location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所登録
router.post('/', async (req, res) => {
    try {
        const { location_code, location_name, address, phone, contact_person } = req.body;

        // バリデーション
        if (!location_code || !location_name) {
            return res.status(400).json({ error: 'Location code and name are required' });
        }

        const result = await pool.query(
            `INSERT INTO shipping_locations
             (location_code, location_name, address, phone, contact_person)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [location_code, location_name, address || null, phone || null, contact_person || null]
        );

        logger.info('Shipping location created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping location:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Location code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所更新
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { location_code, location_name, address, phone, contact_person } = req.body;

        // バリデーション
        if (!location_code || !location_name) {
            return res.status(400).json({ error: 'Location code and name are required' });
        }

        const result = await pool.query(
            `UPDATE shipping_locations
             SET location_code = $1, location_name = $2, address = $3,
                 phone = $4, contact_person = $5
             WHERE id = $6
             RETURNING *`,
            [location_code, location_name, address || null, phone || null, contact_person || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping location not found' });
        }

        logger.info('Shipping location updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating shipping location:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Location code already exists' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷場所削除
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM shipping_locations WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping location not found' });
        }

        logger.info('Shipping location deleted:', result.rows[0]);
        res.json({ message: 'Shipping location deleted successfully' });
    } catch (error) {
        logger.error('Error deleting shipping location:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: location is referenced by shipping instructions' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
