/**
 * shipping-instructions API ルーター(server.js から抽出、振る舞い不変。重複定義・順序も保持)
 * マウント: /shipping-instructions と /api/shipping-instructions
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const Joi = require('joi');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const {
            status,
            priority,
            shipping_location,
            delivery_location,
            shipping_date_from,
            shipping_date_to,
            instruction_id
        } = req.query;

        let query = `
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
        `;
        const params = [];
        const conditions = [];

        if (status) {
            conditions.push('si.status = $' + (params.length + 1));
            params.push(status);
        }

        if (priority) {
            conditions.push('si.priority = $' + (params.length + 1));
            params.push(priority);
        }

        if (shipping_location) {
            conditions.push('sl.location_code = $' + (params.length + 1));
            params.push(shipping_location);
        }

        if (delivery_location) {
            conditions.push('dl.location_code = $' + (params.length + 1));
            params.push(delivery_location);
        }

        if (instruction_id) {
            conditions.push('si.instruction_id ILIKE $' + (params.length + 1));
            params.push(`%${instruction_id}%`);
        }

        if (shipping_date_from) {
            conditions.push('si.shipping_date >= $' + (params.length + 1));
            params.push(shipping_date_from);
        }

        if (shipping_date_to) {
            conditions.push('si.shipping_date <= $' + (params.length + 1));
            params.push(shipping_date_to);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY si.instruction_id ASC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping instructions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   sl.address as shipping_address,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone,
                   dl.contact_person as delivery_contact
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE si.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示登録

router.post('/', async (req, res) => {
    try {
        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = req.body;

        // バリデーション
        if (!instruction_id || !product_id || !quantity) {
            return res.status(400).json({
                error: 'Instruction ID, product ID, and quantity are required'
            });
        }

        if (quantity <= 0) {
            return res.status(400).json({
                error: 'Quantity must be greater than 0'
            });
        }

        const result = await pool.query(`
            INSERT INTO shipping_instructions
            (instruction_id, product_id, quantity, shipping_date,
             shipping_location_id, delivery_location_id, customer_name,
             priority, status, tracking_number, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            instruction_id,
            product_id,
            quantity,
            shipping_date || null,
            shipping_location_id || null,
            delivery_location_id || null,
            customer_name || null,
            priority || 'normal',
            status || 'pending',
            tracking_number || null,
            notes || null
        ]);

        logger.info('Shipping instruction created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping instruction:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Instruction ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product, shipping location, or delivery location ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示更新

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = req.body;

        // バリデーション
        if (!instruction_id || !product_id || !quantity) {
            return res.status(400).json({
                error: 'Instruction ID, product ID, and quantity are required'
            });
        }

        if (quantity <= 0) {
            return res.status(400).json({
                error: 'Quantity must be greater than 0'
            });
        }

        const result = await pool.query(`
            UPDATE shipping_instructions
            SET instruction_id = $1, product_id = $2, quantity = $3,
                shipping_date = $4, shipping_location_id = $5,
                delivery_location_id = $6, customer_name = $7,
                priority = $8, status = $9, tracking_number = $10,
                notes = $11, updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
            RETURNING *
        `, [
            instruction_id,
            product_id,
            quantity,
            shipping_date || null,
            shipping_location_id || null,
            delivery_location_id || null,
            customer_name || null,
            priority || 'normal',
            status || 'pending',
            tracking_number || null,
            notes || null,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating shipping instruction:', error);
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Instruction ID already exists' });
        }
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Invalid product, shipping location, or delivery location ID' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示削除

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 関連する検品データの確認
        const relatedRecords = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM shipping_inspections WHERE shipping_instruction_id = $1) as shipping_inspections,
                (SELECT COUNT(*) FROM qr_inspections WHERE shipping_instruction_id = $1) as qr_inspections
        `, [id]);

        const relations = relatedRecords.rows[0];
        const hasRelations = Object.values(relations).some(count => parseInt(count) > 0);

        if (hasRelations) {
            return res.status(409).json({
                error: '関連する検品データが存在するため削除できません',
                relations: relations
            });
        }

        const result = await pool.query(
            'DELETE FROM shipping_instructions WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction deleted:', result.rows[0]);
        res.json({ message: 'Shipping instruction deleted successfully' });
    } catch (error) {
        logger.error('Error deleting shipping instruction:', error);
        if (error.code === '23503') { // Foreign key violation
            return res.status(409).json({ error: 'Cannot delete: shipping instruction is referenced by other records' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所別サマリー取得

router.get('/summary/by-delivery-location', async (req, res) => {
    try {
        const {
            shipping_location,
            delivery_location,
            shipping_date_from,
            shipping_date_to,
            instruction_id
        } = req.query;

        let query = `
            SELECT 
                dl.location_code,
                dl.location_name,
                dl.address,
                dl.phone,
                dl.contact_person,
                dl.delivery_method,
                COUNT(si.id) as total_items,
                SUM(si.quantity) as total_quantity,
                SUM(CASE WHEN si.status = 'delivered' THEN 1 ELSE 0 END) as completed_items,
                SUM(CASE WHEN si.status = 'pending' THEN 1 ELSE 0 END) as pending_items,
                SUM(CASE WHEN si.status = 'processing' THEN 1 ELSE 0 END) as processing_items,
                SUM(CASE WHEN si.status = 'shipped' THEN 1 ELSE 0 END) as shipped_items,
                MIN(si.shipping_date) as earliest_shipping_date,
                MAX(si.shipping_date) as latest_shipping_date
            FROM delivery_locations dl
            LEFT JOIN shipping_instructions si ON dl.id = si.delivery_location_id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
        `;
        const params = [];
        const conditions = [];

        if (shipping_location) {
            conditions.push('sl.location_code = $' + (params.length + 1));
            params.push(shipping_location);
        }

        if (delivery_location) {
            conditions.push('dl.location_code = $' + (params.length + 1));
            params.push(delivery_location);
        }

        if (instruction_id) {
            conditions.push('si.instruction_id ILIKE $' + (params.length + 1));
            params.push(`%${instruction_id}%`);
        }

        if (shipping_date_from) {
            conditions.push('si.shipping_date >= $' + (params.length + 1));
            params.push(shipping_date_from);
        }

        if (shipping_date_to) {
            conditions.push('si.shipping_date <= $' + (params.length + 1));
            params.push(shipping_date_to);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += `
            GROUP BY dl.id, dl.location_code, dl.location_name, dl.address, dl.phone, dl.contact_person, dl.delivery_method
            HAVING COUNT(si.id) > 0
            ORDER BY dl.location_name
        `;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching delivery location summary:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 納入場所詳細（品目リスト）取得

router.get('/detail/:deliveryLocationCode', async (req, res) => {
    try {
        const { deliveryLocationCode } = req.params;
        const {
            shipping_location,
            shipping_date_from,
            shipping_date_to,
            instruction_id
        } = req.query;

        let query = `
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone,
                   dl.contact_person as delivery_contact
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE dl.location_code = $1
        `;
        const params = [deliveryLocationCode];
        const conditions = [];

        if (shipping_location) {
            conditions.push('sl.location_code = $' + (params.length + 1));
            params.push(shipping_location);
        }

        if (instruction_id) {
            conditions.push('si.instruction_id ILIKE $' + (params.length + 1));
            params.push(`%${instruction_id}%`);
        }

        if (shipping_date_from) {
            conditions.push('si.shipping_date >= $' + (params.length + 1));
            params.push(shipping_date_from);
        }

        if (shipping_date_to) {
            conditions.push('si.shipping_date <= $' + (params.length + 1));
            params.push(shipping_date_to);
        }

        if (conditions.length > 0) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += ' ORDER BY si.shipping_date ASC, si.created_at DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching delivery location detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 単一出荷指示の詳細取得

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name as shipping_location_name,
                   sl.location_code as shipping_location_code,
                   dl.location_name as delivery_location_name,
                   dl.location_code as delivery_location_code,
                   dl.address as delivery_address,
                   dl.phone as delivery_phone,
                   dl.contact_person as delivery_contact,
                   dl.delivery_method
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE si.id = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error fetching shipping instruction detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ピッキング情報の更新

router.patch('/:id/picking', async (req, res) => {
    try {
        const { id } = req.params;
        const { picked_quantity, notes } = req.body;

        // バリデーション
        if (picked_quantity !== undefined && (picked_quantity < 0 || !Number.isInteger(picked_quantity))) {
            return res.status(400).json({ error: 'Invalid picked_quantity' });
        }

        const query = `
            UPDATE shipping_instructions 
            SET picked_quantity = $1,
                picking_notes = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
        `;

        const result = await pool.query(query, [picked_quantity, notes, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        res.json({ message: 'Picking information updated successfully', data: result.rows[0] });
    } catch (error) {
        logger.error('Error updating picking information:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// === 出荷検品関連API ===

router.get('/:id/components', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT pc.*, p.product_code, p.product_name, si.quantity, si.instruction_id,
                   i.current_stock, i.available_stock
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            JOIN product_components pc ON p.id = pc.product_id
            LEFT JOIN inventory i ON p.id = i.product_id
            WHERE si.id = $1
            ORDER BY 
                CASE pc.component_type 
                    WHEN 'main' THEN 1 
                    WHEN 'accessory' THEN 2 
                    WHEN 'manual' THEN 3 
                    WHEN 'warranty' THEN 4 
                    ELSE 5 
                END, pc.component_name
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction or components not found' });
        }

        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping instruction components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// QR検品開始
// qr-inspections API はルーターへ分離(routes/qr-inspections.js)

router.get('/:id/qr-inspection-data', async (req, res) => {
    try {
        const { id } = req.params;

        // 1. 出荷指示詳細を取得
        const shippingResult = await pool.query(`
            SELECT
                si.id,
                si.instruction_id,
                si.quantity,
                si.shipping_date,
                si.customer_name,
                si.priority,
                si.status,
                si.notes,
                p.id as product_id,
                p.product_code,
                p.product_name,
                p.description as product_description,
                sl.location_name as shipping_location_name,
                sl.address as shipping_location_address,
                dl.location_name as delivery_location_name,
                dl.address as delivery_location_address
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            WHERE si.id = $1
        `, [id]);

        if (shippingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        const shipping = shippingResult.rows[0];

        // 2. 製品構成部品を取得
        const componentsResult = await pool.query(`
            SELECT
                pc.id,
                pc.component_type,
                pc.component_name,
                pc.qr_code,
                pc.is_required
            FROM product_components pc
            WHERE pc.product_id = $1
            ORDER BY
                CASE pc.component_type
                    WHEN 'main' THEN 1
                    WHEN 'accessory' THEN 2
                    WHEN 'documentation' THEN 3
                    WHEN 'packaging' THEN 4
                    ELSE 5
                END,
                pc.id
        `, [shipping.product_id]);

        // 3. 在庫情報を取得
        let inventory = null;
        try {
            const inventoryResult = await pool.query(`
                SELECT
                    i.id,
                    i.product_id,
                    i.current_stock,
                    i.reserved_stock,
                    i.available_stock,
                    i.location,
                    i.last_updated
                FROM inventory i
                WHERE i.product_id = $1
                LIMIT 1
            `, [shipping.product_id]);

            if (inventoryResult.rows.length > 0) {
                inventory = inventoryResult.rows[0];
            }
        } catch (err) {
            // 在庫テーブルがない場合はスキップ
            logger.warn('Inventory table not found or query failed:', err.message);
        }

        // 4. 既存の検品レコードを確認（進行中のものがあれば）
        const existingInspectionResult = await pool.query(`
            SELECT
                qi.id,
                qi.status,
                qi.inspector_name,
                qi.created_at
            FROM qr_inspections qi
            WHERE qi.shipping_instruction_id = $1
              AND qi.status = 'in_progress'
            ORDER BY qi.created_at DESC
            LIMIT 1
        `, [id]);

        const existingInspection = existingInspectionResult.rows.length > 0
            ? existingInspectionResult.rows[0]
            : null;

        // 5. 既存の検品セッションがある場合、スキャン済みアイテムを取得
        let scannedQRCodes = [];
        if (existingInspection) {
            const scannedResult = await pool.query(`
                SELECT DISTINCT qid.qr_code
                FROM qr_inspection_details qid
                WHERE qid.qr_inspection_id = $1
                  AND qid.status = 'scanned'
            `, [existingInspection.id]);

            scannedQRCodes = scannedResult.rows.map(row => row.qr_code);
        }

        // 6. レスポンスを返す
        res.json({
            shipping: shipping,
            components: componentsResult.rows,
            inventory: inventory,
            existingInspection: existingInspection,
            scannedQRCodes: scannedQRCodes
        });

    } catch (error) {
        logger.error('Error fetching QR inspection data:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});

// === 検品者マスタ CRUD API ===

// 検品者一覧取得
// inspectors API はルーターへ分離(routes/inspectors.js)

router.post('/', async (req, res) => {
    try {
        const { error, value } = shippingInstructionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = value;

        // instruction_idの重複チェック
        const duplicateCheck = await pool.query(
            'SELECT id FROM shipping_instructions WHERE instruction_id = $1',
            [instruction_id]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ error: '出荷指示IDが既に存在します' });
        }

        const result = await pool.query(`
            INSERT INTO shipping_instructions (
                instruction_id, product_id, quantity, shipping_date,
                shipping_location_id, delivery_location_id, customer_name,
                priority, status, tracking_number, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `, [
            instruction_id, product_id, quantity, shipping_date,
            shipping_location_id, delivery_location_id, customer_name,
            priority, status, tracking_number, notes
        ]);

        logger.info('Shipping instruction created:', result.rows[0]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error creating shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示更新

router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = shippingInstructionSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: error.details[0].message });
        }

        const {
            instruction_id,
            product_id,
            quantity,
            shipping_date,
            shipping_location_id,
            delivery_location_id,
            customer_name,
            priority,
            status,
            tracking_number,
            notes
        } = value;

        // instruction_idの重複チェック（自分以外）
        const duplicateCheck = await pool.query(
            'SELECT id FROM shipping_instructions WHERE instruction_id = $1 AND id != $2',
            [instruction_id, id]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ error: '出荷指示IDが既に存在します' });
        }

        const result = await pool.query(`
            UPDATE shipping_instructions
            SET instruction_id = $1,
                product_id = $2,
                quantity = $3,
                shipping_date = $4,
                shipping_location_id = $5,
                delivery_location_id = $6,
                customer_name = $7,
                priority = $8,
                status = $9,
                tracking_number = $10,
                notes = $11,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $12
            RETURNING *
        `, [
            instruction_id, product_id, quantity, shipping_date,
            shipping_location_id, delivery_location_id, customer_name,
            priority, status, tracking_number, notes, id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction updated:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        logger.error('Error updating shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示削除

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // 関連する検品記録があるかチェック
        const inspectionCheck = await pool.query(
            'SELECT id FROM shipping_inspections WHERE shipping_instruction_id = $1',
            [id]
        );

        if (inspectionCheck.rows.length > 0) {
            return res.status(409).json({
                error: '検品記録が存在するため削除できません',
                details: '先に検品記録を削除してください'
            });
        }

        // QR検品記録があるかチェック
        const qrInspectionCheck = await pool.query(
            'SELECT id FROM qr_inspections WHERE shipping_instruction_id = $1',
            [id]
        );

        if (qrInspectionCheck.rows.length > 0) {
            return res.status(409).json({
                error: 'QR検品記録が存在するため削除できません',
                details: '先にQR検品記録を削除してください'
            });
        }

        const result = await pool.query(
            'DELETE FROM shipping_instructions WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        logger.info('Shipping instruction deleted:', result.rows[0]);
        res.json({ message: 'Shipping instruction deleted successfully', data: result.rows[0] });
    } catch (error) {
        logger.error('Error deleting shipping instruction:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷検品記録の作成
const shippingInspectionSchema = Joi.object({
    shipping_instruction_id: Joi.number().required(),
    inspector_name: Joi.string().max(100).required(),
    inspected_quantity: Joi.number().min(0).required(),
    passed_quantity: Joi.number().min(0).required(),
    failed_quantity: Joi.number().min(0).default(0),
    defect_details: Joi.string().allow(''),
    packaging_condition: Joi.string().max(50),
    label_check: Joi.boolean().default(false),
    documentation_check: Joi.boolean().default(false),
    final_approval: Joi.boolean().default(false),
    notes: Joi.string().allow('')
});

router.get('/:id/pps-status', async (req, res) => {
    try {
        const { id } = req.params;
        const si = await pool.query(`
            SELECT si.*, p.product_code, p.product_name
            FROM shipping_instructions si JOIN products p ON si.product_id = p.id
            WHERE si.id = $1
        `, [id]);
        if (si.rows.length === 0) return res.status(404).json({ error: 'Not found' });

        const picking = await pool.query(
            `SELECT pi.*, json_agg(pr.*) as records
             FROM picking_instructions pi
             LEFT JOIN picking_records pr ON pi.id = pr.picking_instruction_id
             WHERE pi.shipping_instruction_id = $1
             GROUP BY pi.id ORDER BY pi.created_at DESC LIMIT 1`, [id]
        );
        const packing = await pool.query(
            `SELECT * FROM packing_records WHERE shipping_instruction_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]
        );
        const qrInspection = await pool.query(
            `SELECT qi.*, json_agg(qid.*) as details
             FROM qr_inspections qi
             LEFT JOIN qr_inspection_details qid ON qi.id = qid.qr_inspection_id
             WHERE qi.shipping_instruction_id = $1
             GROUP BY qi.id ORDER BY qi.created_at DESC LIMIT 1`, [id]
        );
        const lotInfo = await pool.query(
            `SELECT li.* FROM lot_inventory li WHERE li.product_id = $1 AND li.status='available' ORDER BY li.lot_number`,
            [si.rows[0].product_id]
        );

        res.json({
            shipping: si.rows[0],
            picking: picking.rows[0] || null,
            packing: packing.rows[0] || null,
            qr_inspection: qrInspection.rows[0] || null,
            available_lots: lotInfo.rows
        });
    } catch (error) {
        logger.error('Error fetching PPS status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// エラーハンドリング

module.exports = router;
