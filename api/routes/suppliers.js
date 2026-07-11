const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

const supplierSchema = Joi.object({
    supplier_code: Joi.string().max(50).required(),
    supplier_name: Joi.string().max(255).required(),
    address: Joi.string().allow('', null),
    phone: Joi.string().max(50).allow('', null),
    contact_person: Joi.string().max(100).allow('', null),
    email: Joi.string().email().allow('', null),
    notes: Joi.string().allow('', null),
    is_active: Joi.boolean().default(true)
});

router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM suppliers ORDER BY supplier_code');
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching suppliers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { error, value } = supplierSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });
        const result = await pool.query(`
            INSERT INTO suppliers
              (supplier_code, supplier_name, address, phone, contact_person, email, notes, is_active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
        `, [
            value.supplier_code,
            value.supplier_name,
            value.address || null,
            value.phone || null,
            value.contact_person || null,
            value.email || null,
            value.notes || null,
            value.is_active !== false
        ]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating supplier:', error);
        if (error.code === '23505') return res.status(409).json({ error: '仕入先コードが既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
