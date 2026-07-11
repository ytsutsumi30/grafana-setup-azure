/**
 * QR 管理単位 API
 * マウント: /qr-units と /api/qr-units
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

router.get('/:qrCode', async (req, res) => {
    try {
        const { qrCode } = req.params;
        const result = await pool.query(`
            SELECT qu.*,
                   p.product_code,
                   p.product_name,
                   li.quantity AS lot_quantity,
                   COALESCE(loc.location_code, qu.location, li.location) AS current_location_code,
                   loc.location_name,
                   ib.quantity AS balance_quantity,
                   ib.inventory_status
            FROM qr_units qu
            JOIN products p ON p.id = qu.product_id
            LEFT JOIN lot_inventory li ON li.id = qu.lot_inventory_id
            LEFT JOIN locations loc ON loc.id = COALESCE(qu.location_id, li.location_id)
            LEFT JOIN inventory_balances ib ON ib.qr_unit_id = qu.id
            WHERE qu.qr_code = $1
            ORDER BY ib.updated_at DESC NULLS LAST
            LIMIT 1
        `, [qrCode]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'QR unit not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching QR unit:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
