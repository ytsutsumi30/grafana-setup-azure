/**
 * shipping-instructions API ルーター(server.js から抽出、振る舞い不変。重複定義・順序も保持)
 * マウント: /shipping-instructions と /api/shipping-instructions
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const Joi = require('joi');
const { recordAuditEvent } = require('../lib/audit');
const { appendTransaction, InventoryLedgerError } = require('../lib/inventory-ledger');

const router = express.Router();

function buildShipmentCompletionStatus({ shipping, lines = [], picking, packing, ngRecordsCount = 0 }) {
    const allocations = lines.flatMap((line) => line.allocations || []);
    const hasAllocations = allocations.length > 0;
    const totalRequired = hasAllocations
        ? allocations.reduce((sum, allocation) => sum + Number(allocation.shipped_quantity || 0), 0)
        : Number(picking?.total_quantity || shipping?.quantity || 0);
    const totalPicked = hasAllocations
        ? allocations.reduce((sum, allocation) => sum + Number(allocation.picked_quantity || 0), 0)
        : Number(picking?.picked_quantity || 0);
    const blockers = [];
    const warnings = [];

    if (!picking) {
        blockers.push({ code: 'picking_not_started', message: 'PPS / ピッキングが開始されていません' });
    } else if (picking.status !== 'completed') {
        blockers.push({ code: 'picking_not_completed', message: 'PPS / ピッキングが完了していません' });
    }

    if (!packing) {
        blockers.push({ code: 'packing_not_started', message: '梱包が開始されていません' });
    } else if (packing.status !== 'completed') {
        blockers.push({ code: 'packing_not_completed', message: '梱包が完了していません' });
    }

    if (hasAllocations) {
        allocations.forEach((allocation) => {
            const required = Number(allocation.shipped_quantity || 0);
            const picked = Number(allocation.picked_quantity || 0);
            if (picked < required) {
                blockers.push({
                    code: 'allocation_not_fully_picked',
                    message: `${allocation.product_code || ''} ${allocation.lot_number || ''} の検品数量が不足しています`,
                    allocation_id: allocation.id,
                    product_id: allocation.product_id,
                    lot_number: allocation.lot_number,
                    required_quantity: required,
                    picked_quantity: picked,
                    remaining_quantity: Math.max(0, required - picked)
                });
            }
        });
    } else if (totalPicked < totalRequired) {
        blockers.push({
            code: 'legacy_pick_not_fully_completed',
            message: '検品数量が出荷予定数量に達していません',
            required_quantity: totalRequired,
            picked_quantity: totalPicked,
            remaining_quantity: Math.max(0, totalRequired - totalPicked)
        });
    }

    if (totalRequired <= 0) {
        blockers.push({ code: 'no_required_quantity', message: '出荷完了対象の数量がありません' });
    }
    if (ngRecordsCount > 0) {
        warnings.push({
            code: 'ng_or_warning_scans_exist',
            message: `NG または警告スキャンが ${ngRecordsCount} 件あります。監査ログを確認してください`,
            count: ngRecordsCount
        });
    }

    const alreadyCompleted = ['shipped', 'delivered'].includes(shipping?.status);
    if (alreadyCompleted && totalPicked < totalRequired) {
        warnings.push({
            code: 'post_completion_correction_scan_mismatch',
            message: '完了後修正により、現在のロット引当とスキャン履歴のロット番号が一致しない可能性があります',
            required_quantity: totalRequired,
            picked_quantity: totalPicked
        });
    }
    return {
        shipping_instruction_id: shipping?.id || null,
        status: shipping?.status || null,
        already_completed: alreadyCompleted,
        can_complete: !alreadyCompleted && blockers.length === 0,
        total_required_quantity: totalRequired,
        total_picked_quantity: alreadyCompleted ? Math.max(totalPicked, totalRequired) : totalPicked,
        remaining_quantity: alreadyCompleted ? 0 : Math.max(0, totalRequired - totalPicked),
        blockers: alreadyCompleted ? [] : blockers,
        warnings
    };
}

async function loadShipmentCompletionStatus(clientOrPool, id) {
    const siResult = await clientOrPool.query(`
        SELECT si.*, p.product_code, p.product_name
        FROM shipping_instructions si
        JOIN products p ON p.id = si.product_id
        WHERE si.id = $1
    `, [id]);
    if (siResult.rows.length === 0) return null;

    const shipping = siResult.rows[0];
    const pickingResult = await clientOrPool.query(`
        SELECT *
        FROM picking_instructions
        WHERE shipping_instruction_id = $1
        ORDER BY created_at DESC
        LIMIT 1
    `, [id]);
    const picking = pickingResult.rows[0] || null;

    const packingResult = await clientOrPool.query(`
        SELECT *
        FROM packing_records
        WHERE shipping_instruction_id = $1
        ORDER BY created_at DESC
        LIMIT 1
    `, [id]);
    const packing = packingResult.rows[0] || null;

    const linesResult = await clientOrPool.query(`
        SELECT l.id, l.shipping_instruction_id, l.product_id, l.quantity,
               l.shipped_quantity, l.status, p.product_code, p.product_name
        FROM shipping_instruction_lines l
        JOIN products p ON p.id = l.product_id
        WHERE l.shipping_instruction_id = $1
        ORDER BY l.id
    `, [id]);
    const effectiveLines = linesResult.rows.length > 0 ? linesResult.rows : [{
        id: null,
        shipping_instruction_id: shipping.id,
        product_id: shipping.product_id,
        quantity: shipping.quantity || 0,
        shipped_quantity: shipping.quantity || 0,
        status: 'legacy',
        product_code: shipping.product_code,
        product_name: shipping.product_name,
        allocations: []
    }];

    const allocationsResult = linesResult.rows.length > 0
        ? await clientOrPool.query(`
            SELECT a.id, a.shipping_instruction_line_id, a.lot_inventory_id,
                   a.lot_number, a.product_id, a.shipped_quantity,
                   a.operator_name, a.status, a.scanned_at,
                   p.product_code, p.product_name,
                   COALESCE(SUM(CASE WHEN pr.status = 'picked' THEN pr.picked_quantity ELSE 0 END), 0)::int AS picked_quantity
            FROM shipping_lot_allocations a
            JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
            JOIN products p ON p.id = a.product_id
            LEFT JOIN picking_records pr
              ON pr.lot_number = a.lot_number
             AND pr.product_id = a.product_id
             AND ($2::int IS NULL OR pr.picking_instruction_id = $2)
            WHERE l.shipping_instruction_id = $1
              AND a.status = 'shipped'
            GROUP BY a.id, p.product_code, p.product_name
            ORDER BY p.product_code, a.lot_number, a.id
        `, [id, picking ? picking.id : null])
        : { rows: [] };
    const allocationsByLine = allocationsResult.rows.reduce((acc, allocation) => {
        const key = String(allocation.shipping_instruction_line_id);
        if (!acc[key]) acc[key] = [];
        acc[key].push({
            ...allocation,
            remaining_pick_quantity: Math.max(0, Number(allocation.shipped_quantity || 0) - Number(allocation.picked_quantity || 0))
        });
        return acc;
    }, {});
    const lines = effectiveLines.map((line) => ({
        ...line,
        allocations: line.id ? (allocationsByLine[String(line.id)] || []) : []
    }));

    const ngRecordsResult = picking
        ? await clientOrPool.query(`
            SELECT COUNT(*)::int AS count
            FROM picking_records
            WHERE picking_instruction_id = $1
              AND status <> 'picked'
        `, [picking.id])
        : { rows: [{ count: 0 }] };

    return buildShipmentCompletionStatus({
        shipping,
        lines,
        picking,
        packing,
        ngRecordsCount: Number(ngRecordsResult.rows[0]?.count || 0)
    });
}

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
                   dl.phone as delivery_phone,
                   COALESCE(audit.cancelled_scan_count, 0)::int AS cancelled_scan_count,
                   COALESCE(audit.post_completion_correction_count, 0)::int AS post_completion_correction_count,
                   audit.last_shipping_audit_at
            FROM shipping_instructions si
            JOIN products p ON si.product_id = p.id
            LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
            LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
            LEFT JOIN (
                SELECT shipping_instruction_id,
                       COUNT(*) FILTER (WHERE event_type = 'qr_scan_cancelled') AS cancelled_scan_count,
                       COUNT(*) FILTER (WHERE event_type = 'post_completion_corrected') AS post_completion_correction_count,
                       MAX(occurred_at) FILTER (
                           WHERE event_type IN ('qr_scan_cancelled', 'post_completion_corrected')
                       ) AS last_shipping_audit_at
                FROM shipping_audit_events
                WHERE event_type IN ('qr_scan_cancelled', 'post_completion_corrected')
                GROUP BY shipping_instruction_id
            ) audit ON audit.shipping_instruction_id = si.id
        `;
        const params = [];
        const conditions = [];

        if (status) {
            const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
            if (statuses.length > 1) {
                conditions.push('si.status = ANY($' + (params.length + 1) + '::text[])');
                params.push(statuses);
            } else if (statuses.length === 1) {
                conditions.push('si.status = $' + (params.length + 1));
                params.push(statuses[0]);
            }
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
                priority = $8, status = COALESCE($9, status), tracking_number = $10,
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
            status || null,
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
                status = COALESCE($9, status),
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

        const lines = await pool.query(`
            SELECT l.id, l.shipping_instruction_id, l.product_id, l.quantity,
                   l.shipped_quantity, l.status,
                   p.product_code, p.product_name,
                   (l.quantity - l.shipped_quantity) AS remaining_quantity
            FROM shipping_instruction_lines l
            JOIN products p ON p.id = l.product_id
            WHERE l.shipping_instruction_id = $1
            ORDER BY l.id
        `, [id]);
        const effectiveLines = lines.rows.length > 0 ? lines.rows : (si.rows[0].product_id ? [{
            id: null,
            shipping_instruction_id: si.rows[0].id,
            product_id: si.rows[0].product_id,
            quantity: si.rows[0].quantity || 0,
            shipped_quantity: 0,
            status: 'legacy',
            product_code: si.rows[0].product_code,
            product_name: si.rows[0].product_name,
            remaining_quantity: si.rows[0].quantity || 0,
            legacy: true
        }] : []);
        const totalQuantity = effectiveLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        const productIds = [...new Set(effectiveLines.map((line) => line.product_id).filter(Boolean))];

        const picking = await pool.query(
            `SELECT *
             FROM picking_instructions
             WHERE shipping_instruction_id = $1
             ORDER BY created_at DESC LIMIT 1`, [id]
        );
        let pickingRow = picking.rows[0] || null;
        let pickingRecords = [];
        if (pickingRow) {
            const records = await pool.query(`
                SELECT pr.*, p.product_code, p.product_name
                FROM picking_records pr
                LEFT JOIN products p ON p.id = pr.product_id
                WHERE pr.picking_instruction_id = $1
                ORDER BY pr.scanned_at DESC, pr.id DESC
            `, [pickingRow.id]);
            pickingRecords = records.rows;
            pickingRow = { ...pickingRow, records: pickingRecords };
        }

        const allocations = lines.rows.length
            ? await pool.query(`
                SELECT a.id, a.shipping_instruction_line_id, a.lot_inventory_id,
                       a.lot_number, a.product_id, a.shipped_quantity,
                       a.operator_name, a.status, a.scanned_at,
                       p.product_code, p.product_name,
                       li.location,
                       COALESCE(SUM(CASE WHEN pr.status = 'picked' THEN pr.picked_quantity ELSE 0 END), 0)::int AS picked_quantity
                FROM shipping_lot_allocations a
                JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
                JOIN products p ON p.id = a.product_id
                LEFT JOIN lot_inventory li ON li.id = a.lot_inventory_id
                LEFT JOIN picking_records pr
                  ON pr.lot_number = a.lot_number
                 AND pr.product_id = a.product_id
                 AND pr.picking_instruction_id = $2
                WHERE l.shipping_instruction_id = $1
                  AND a.status = 'shipped'
                GROUP BY a.id, p.product_code, p.product_name, li.location
                ORDER BY p.product_code, a.lot_number, a.id
            `, [id, pickingRow ? pickingRow.id : null])
            : { rows: [] };
        const allocationsByLine = allocations.rows.reduce((acc, allocation) => {
            const key = String(allocation.shipping_instruction_line_id);
            if (!acc[key]) acc[key] = [];
            const allocated = Number(allocation.shipped_quantity || 0);
            const picked = Number(allocation.picked_quantity || 0);
            acc[key].push({
                ...allocation,
                remaining_pick_quantity: Math.max(0, allocated - picked)
            });
            return acc;
        }, {});
        const enrichedLines = effectiveLines.map((line) => {
            const lineAllocations = line.id ? (allocationsByLine[String(line.id)] || []) : [];
            const allocatedQuantity = lineAllocations.reduce((sum, allocation) => sum + Number(allocation.shipped_quantity || 0), 0);
            const pickedQuantity = lineAllocations.reduce((sum, allocation) => sum + Number(allocation.picked_quantity || 0), 0);
            return {
                ...line,
                allocations: lineAllocations,
                allocated_quantity: allocatedQuantity,
                picked_quantity: pickedQuantity,
                remaining_pick_quantity: Math.max(0, allocatedQuantity - pickedQuantity)
            };
        });
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
        const lotInfo = productIds.length
            ? await pool.query(
                `SELECT li.*, p.product_code, p.product_name
                 FROM lot_inventory li
                 JOIN products p ON p.id = li.product_id
                 WHERE li.product_id = ANY($1::int[]) AND li.status='available'
                 ORDER BY p.product_code, li.lot_number`,
                [productIds]
            )
            : { rows: [] };

        const shipping = {
            ...si.rows[0],
            line_count: effectiveLines.length,
            line_total_quantity: totalQuantity,
            quantity: totalQuantity || si.rows[0].quantity,
            allocated_quantity: allocations.rows.reduce((sum, allocation) => sum + Number(allocation.shipped_quantity || 0), 0),
            picked_quantity: pickingRow ? Number(pickingRow.picked_quantity || 0) : 0,
            product_code: effectiveLines.length > 1 ? 'MULTI' : si.rows[0].product_code,
            product_name: effectiveLines.length > 1 ? `${effectiveLines.length}品目` : si.rows[0].product_name
        };
        const completion = buildShipmentCompletionStatus({
            shipping,
            lines: enrichedLines,
            picking: pickingRow,
            packing: packing.rows[0] || null,
            ngRecordsCount: pickingRecords.filter((record) => record && record.status !== 'picked').length
        });

        res.json({
            shipping,
            lines: enrichedLines,
            allocations: allocations.rows,
            picking: pickingRow,
            packing: packing.rows[0] || null,
            qr_inspection: qrInspection.rows[0] || null,
            available_lots: lotInfo.rows,
            completion
        });
    } catch (error) {
        logger.error('Error fetching PPS status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id/completion-status', async (req, res) => {
    try {
        const { id } = req.params;
        const completion = await loadShipmentCompletionStatus(pool, id);
        if (!completion) return res.status(404).json({ error: 'Shipping instruction not found' });
        res.json(completion);
    } catch (error) {
        logger.error('Error fetching shipment completion status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/:id/complete-shipment', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');

        const completion = await loadShipmentCompletionStatus(client, id);
        if (!completion) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }
        if (completion.already_completed) {
            await client.query('ROLLBACK');
            return res.json({ success: true, already_completed: true, completion });
        }
        if (!completion.can_complete) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: '出荷完了条件を満たしていません',
                completion
            });
        }

        const beforeResult = await client.query('SELECT * FROM shipping_instructions WHERE id = $1 FOR UPDATE', [id]);
        const before = beforeResult.rows[0];
        const updated = await client.query(`
            UPDATE shipping_instructions
            SET status = 'shipped', updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [id]);

        await recordAuditEvent(client, req, {
            shipping_instruction_id: Number(id),
            event_type: 'shipment_completed',
            event_status: 'success',
            quantity: completion.total_picked_quantity,
            before_data: {
                status: before.status,
                completion
            },
            after_data: {
                status: updated.rows[0].status,
                total_required_quantity: completion.total_required_quantity,
                total_picked_quantity: completion.total_picked_quantity
            },
            comment: req.body?.comment || null
        });

        await client.query('COMMIT');
        res.json({ success: true, shipping: updated.rows[0], completion });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error completing shipment:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

const postCompletionCorrectionSchema = Joi.object({
    allocation_id: Joi.number().integer().required(),
    reason_code: Joi.string().max(100).required(),
    comment: Joi.string().max(1000).allow('', null),
    lot_number: Joi.string().max(100).allow('', null),
    shipped_quantity: Joi.number().integer().min(1)
}).or('lot_number', 'shipped_quantity');

router.post('/:id/post-completion-corrections', async (req, res) => {
    const { error, value } = postCompletionCorrectionSchema.validate(req.body || {}, { abortEarly: false });
    if (error) {
        return res.status(400).json({
            error: 'Invalid request',
            details: error.details.map((detail) => detail.message)
        });
    }

    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');

        const siResult = await client.query('SELECT * FROM shipping_instructions WHERE id = $1 FOR UPDATE', [id]);
        if (siResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }
        const shipping = siResult.rows[0];
        if (!['shipped', 'delivered'].includes(shipping.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '完了後修正は出荷完了後のみ実行できます' });
        }

        const allocationResult = await client.query(`
            SELECT a.*, l.shipping_instruction_id, l.quantity AS line_quantity,
                   p.product_code, p.product_name
            FROM shipping_lot_allocations a
            JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
            JOIN products p ON p.id = a.product_id
            WHERE a.id = $1
              AND l.shipping_instruction_id = $2
              AND a.status = 'shipped'
            FOR UPDATE OF a, l
        `, [value.allocation_id, id]);
        if (allocationResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Lot allocation not found' });
        }

        const before = allocationResult.rows[0];
        const nextLotNumber = value.lot_number ? value.lot_number.trim() : before.lot_number;
        const nextQuantity = value.shipped_quantity !== undefined
            ? Number(value.shipped_quantity)
            : Number(before.shipped_quantity || 0);
        const otherAllocations = await client.query(`
            SELECT COALESCE(SUM(shipped_quantity), 0)::int AS total_quantity
            FROM shipping_lot_allocations
            WHERE shipping_instruction_line_id = $1
              AND id <> $2
              AND status = 'shipped'
        `, [before.shipping_instruction_line_id, before.id]);
        const correctedLineTotal = Number(otherAllocations.rows[0]?.total_quantity || 0) + nextQuantity;
        if (correctedLineTotal > Number(before.line_quantity || 0)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: `修正後のロット引当合計(${correctedLineTotal})が明細指示数量(${before.line_quantity})を超えています`,
                code: 'SHIPPING_LINE_QUANTITY_EXCEEDED',
                corrected_total_quantity: correctedLineTotal,
                line_quantity: Number(before.line_quantity || 0)
            });
        }
        let nextLotInventoryId = before.lot_inventory_id;
        if (nextLotNumber !== before.lot_number) {
            const lotResult = await client.query(`
                SELECT id
                FROM lot_inventory
                WHERE product_id = $1
                  AND lot_number = $2
                ORDER BY id DESC
                LIMIT 1
            `, [before.product_id, nextLotNumber]);
            nextLotInventoryId = lotResult.rows[0]?.id || null;
        }
        if (!nextLotInventoryId) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '修正先ロットが存在しません' });
        }

        const correctionLots = await client.query(`
            SELECT *
            FROM lot_inventory
            WHERE id = ANY($1::int[])
            ORDER BY id
            FOR UPDATE
        `, [[...new Set([before.lot_inventory_id, nextLotInventoryId].filter(Boolean))]]);
        const lotsById = new Map(correctionLots.rows.map((lot) => [Number(lot.id), lot]));
        const beforeLot = lotsById.get(Number(before.lot_inventory_id));
        const nextLot = lotsById.get(Number(nextLotInventoryId));
        if (!beforeLot || !nextLot) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '修正対象ロットの在庫情報が見つかりません' });
        }

        const inventoryMovements = [];
        if (Number(beforeLot.id) === Number(nextLot.id)) {
            const adjustment = Number(before.shipped_quantity || 0) - nextQuantity;
            if (adjustment !== 0) {
                inventoryMovements.push(await appendTransaction(client, {
                    transaction_type: 'inventory_adjustment',
                    inventory_status: 'available',
                    product_id: before.product_id,
                    lot_inventory_id: beforeLot.id,
                    lot_number: beforeLot.lot_number,
                    location_id: beforeLot.location_id || null,
                    location_code: beforeLot.location || null,
                    quantity_delta: adjustment,
                    opening_quantity: Number(beforeLot.quantity || 0),
                    trust_opening_quantity: true,
                    sync_lot_inventory: true,
                    source_type: 'post_completion_correction',
                    source_id: before.id,
                    source_line_id: before.shipping_instruction_line_id,
                    reason_code: value.reason_code,
                    comment: value.comment || '出荷完了後の数量修正',
                    created_by: req.auth?.email || 'shipping-instructions-api'
                }));
            }
        } else {
            inventoryMovements.push(await appendTransaction(client, {
                transaction_type: 'inventory_adjustment',
                inventory_status: 'available',
                product_id: before.product_id,
                lot_inventory_id: beforeLot.id,
                lot_number: beforeLot.lot_number,
                location_id: beforeLot.location_id || null,
                location_code: beforeLot.location || null,
                quantity_delta: Number(before.shipped_quantity || 0),
                opening_quantity: Number(beforeLot.quantity || 0),
                trust_opening_quantity: true,
                sync_lot_inventory: true,
                source_type: 'post_completion_correction_restore',
                source_id: before.id,
                source_line_id: before.shipping_instruction_line_id,
                reason_code: value.reason_code,
                comment: value.comment || '出荷完了後修正で旧ロットへ在庫を戻す',
                created_by: req.auth?.email || 'shipping-instructions-api'
            }));
            inventoryMovements.push(await appendTransaction(client, {
                transaction_type: 'inventory_adjustment',
                inventory_status: 'available',
                product_id: before.product_id,
                lot_inventory_id: nextLot.id,
                lot_number: nextLot.lot_number,
                location_id: nextLot.location_id || null,
                location_code: nextLot.location || null,
                quantity_delta: -nextQuantity,
                opening_quantity: Number(nextLot.quantity || 0),
                trust_opening_quantity: true,
                sync_lot_inventory: true,
                source_type: 'post_completion_correction_apply',
                source_id: before.id,
                source_line_id: before.shipping_instruction_line_id,
                reason_code: value.reason_code,
                comment: value.comment || '出荷完了後修正で新ロットから在庫を控除',
                created_by: req.auth?.email || 'shipping-instructions-api'
            }));
        }

        const updatedAllocation = await client.query(`
            UPDATE shipping_lot_allocations
            SET lot_inventory_id = $1,
                lot_number = $2,
                shipped_quantity = $3,
                scanned_at = CURRENT_TIMESTAMP
            WHERE id = $4
            RETURNING *
        `, [nextLotInventoryId, nextLotNumber, nextQuantity, value.allocation_id]);

        await client.query(`
            UPDATE shipping_instruction_lines l
            SET shipped_quantity = totals.total_quantity,
                status = CASE
                    WHEN totals.total_quantity >= l.quantity THEN 'completed'
                    WHEN totals.total_quantity > 0 THEN 'partial'
                    ELSE 'pending'
                END,
                updated_at = CURRENT_TIMESTAMP
            FROM (
                SELECT shipping_instruction_line_id, COALESCE(SUM(shipped_quantity), 0)::int AS total_quantity
                FROM shipping_lot_allocations
                WHERE shipping_instruction_line_id = $1
                  AND status = 'shipped'
                GROUP BY shipping_instruction_line_id
            ) totals
            WHERE l.id = totals.shipping_instruction_line_id
        `, [before.shipping_instruction_line_id]);

        await recordAuditEvent(client, req, {
            shipping_instruction_id: Number(id),
            line_id: before.shipping_instruction_line_id,
            allocation_id: before.id,
            event_type: 'post_completion_corrected',
            event_status: 'success',
            product_id: before.product_id,
            lot_id: nextLotInventoryId,
            lot_number: nextLotNumber,
            quantity: nextQuantity,
            before_data: {
                lot_inventory_id: before.lot_inventory_id,
                lot_number: before.lot_number,
                shipped_quantity: before.shipped_quantity
            },
            after_data: {
                lot_inventory_id: updatedAllocation.rows[0].lot_inventory_id,
                lot_number: updatedAllocation.rows[0].lot_number,
                shipped_quantity: updatedAllocation.rows[0].shipped_quantity
            },
            reason_code: value.reason_code,
            comment: value.comment || null
        });

        await client.query('COMMIT');
        res.json({
            success: true,
            allocation: updatedAllocation.rows[0],
            inventory_transactions: inventoryMovements.map((movement) => movement.transaction)
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error applying post-completion correction:', error);
        if (error instanceof InventoryLedgerError) {
            return res.status(error.status).json({ error: error.message, code: error.code });
        }
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

const reportEventSchema = Joi.object({
    report_type: Joi.string().valid('inspection_result', 'lot_shipment').required(),
    output_method: Joi.string().valid('html_print', 'browser_pdf').default('html_print'),
    revision_label: Joi.string().max(80).allow('', null),
    comment: Joi.string().max(1000).allow('', null)
});

router.post('/:id/report-events', async (req, res) => {
    const { error, value } = reportEventSchema.validate(req.body || {}, { abortEarly: false });
    if (error) {
        return res.status(400).json({
            error: 'Invalid request',
            details: error.details.map((detail) => detail.message)
        });
    }

    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [4107, Number(id)]);

        const shippingResult = await client.query('SELECT * FROM shipping_instructions WHERE id = $1', [id]);
        if (shippingResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }

        const countResult = await client.query(`
            SELECT COUNT(*)::int AS count
            FROM shipping_audit_events
            WHERE shipping_instruction_id = $1
              AND event_type = 'report_printed'
              AND after_data->>'report_type' = $2
        `, [id, value.report_type]);
        const issueNumber = Number(countResult.rows[0]?.count || 0) + 1;
        const revisionLabel = value.revision_label || (issueNumber === 1 ? '初版' : `再発行${issueNumber}`);

        await recordAuditEvent(client, req, {
            shipping_instruction_id: Number(id),
            event_type: 'report_printed',
            event_status: 'success',
            after_data: {
                report_type: value.report_type,
                output_method: value.output_method,
                revision_label: revisionLabel,
                issue_number: issueNumber
            },
            reason_code: value.report_type,
            comment: value.comment || 'HTML 印刷帳票を出力'
        });

        await client.query('COMMIT');
        res.status(201).json({
            success: true,
            report_type: value.report_type,
            issue_number: issueNumber,
            revision_label: revisionLabel
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error recording report print event:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

router.get('/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        const shippingResult = await pool.query(`
            SELECT si.*, p.product_code, p.product_name,
                   sl.location_name AS shipping_location_name,
                   sl.location_code AS shipping_location_code,
                   dl.location_name AS delivery_location_name,
                   dl.location_code AS delivery_location_code
            FROM shipping_instructions si
            JOIN products p ON p.id = si.product_id
            LEFT JOIN shipping_locations sl ON sl.id = si.shipping_location_id
            LEFT JOIN delivery_locations dl ON dl.id = si.delivery_location_id
            WHERE si.id = $1
        `, [id]);
        if (shippingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Shipping instruction not found' });
        }
        const shipping = shippingResult.rows[0];

        const linesResult = await pool.query(`
            SELECT l.id, l.shipping_instruction_id, l.product_id, l.quantity,
                   l.shipped_quantity, l.status,
                   p.product_code, p.product_name,
                   (l.quantity - l.shipped_quantity) AS remaining_quantity
            FROM shipping_instruction_lines l
            JOIN products p ON p.id = l.product_id
            WHERE l.shipping_instruction_id = $1
            ORDER BY l.id
        `, [id]);
        const effectiveLines = linesResult.rows.length > 0 ? linesResult.rows : [{
            id: null,
            shipping_instruction_id: shipping.id,
            product_id: shipping.product_id,
            quantity: shipping.quantity || 0,
            shipped_quantity: shipping.quantity || 0,
            status: 'legacy',
            product_code: shipping.product_code,
            product_name: shipping.product_name,
            remaining_quantity: 0,
            legacy: true
        }];

        const pickingResult = await pool.query(`
            SELECT *
            FROM picking_instructions
            WHERE shipping_instruction_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [id]);
        const picking = pickingResult.rows[0] || null;
        const packingResult = await pool.query(`
            SELECT *
            FROM packing_records
            WHERE shipping_instruction_id = $1
            ORDER BY created_at DESC
            LIMIT 1
        `, [id]);
        const packing = packingResult.rows[0] || null;

        const allocationsResult = linesResult.rows.length > 0
            ? await pool.query(`
                SELECT a.id, a.shipping_instruction_line_id, a.lot_inventory_id,
                       a.lot_number, a.product_id, a.shipped_quantity,
                       a.operator_name, a.status, a.scanned_at, a.created_at,
                       p.product_code, p.product_name,
                       li.location,
                       COALESCE(SUM(CASE WHEN pr.status = 'picked' THEN pr.picked_quantity ELSE 0 END), 0)::int AS picked_quantity,
                       COUNT(pr.id) FILTER (WHERE pr.status <> 'picked')::int AS ng_scan_count
                FROM shipping_lot_allocations a
                JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
                JOIN products p ON p.id = a.product_id
                LEFT JOIN lot_inventory li ON li.id = a.lot_inventory_id
                LEFT JOIN picking_records pr
                  ON pr.lot_number = a.lot_number
                 AND pr.product_id = a.product_id
                 AND ($2::int IS NULL OR pr.picking_instruction_id = $2)
                WHERE l.shipping_instruction_id = $1
                GROUP BY a.id, p.product_code, p.product_name, li.location
                ORDER BY p.product_code, a.lot_number, a.id
            `, [id, picking ? picking.id : null])
            : { rows: [] };
        const allocationsByLine = allocationsResult.rows.reduce((acc, allocation) => {
            const key = String(allocation.shipping_instruction_line_id);
            if (!acc[key]) acc[key] = [];
            acc[key].push({
                ...allocation,
                remaining_pick_quantity: Math.max(0, Number(allocation.shipped_quantity || 0) - Number(allocation.picked_quantity || 0))
            });
            return acc;
        }, {});

        const recordsResult = picking
            ? await pool.query(`
                SELECT pr.*, p.product_code, p.product_name,
                       a.id AS matched_allocation_id,
                       a.shipping_instruction_line_id AS matched_line_id
                FROM picking_records pr
                LEFT JOIN products p ON p.id = pr.product_id
                LEFT JOIN shipping_lot_allocations a
                  ON a.lot_number = pr.lot_number
                 AND a.product_id = pr.product_id
                 AND a.status = 'shipped'
                 AND a.shipping_instruction_line_id IN (
                    SELECT id FROM shipping_instruction_lines WHERE shipping_instruction_id = $2
                 )
                WHERE pr.picking_instruction_id = $1
                ORDER BY pr.scanned_at DESC, pr.id DESC
            `, [picking.id, id])
            : { rows: [] };
        const recordsByLine = recordsResult.rows.reduce((acc, record) => {
            const key = record.matched_line_id ? String(record.matched_line_id) : 'unmatched';
            if (!acc[key]) acc[key] = [];
            acc[key].push(record);
            return acc;
        }, {});

        const lines = effectiveLines.map((line) => {
            const key = line.id ? String(line.id) : 'legacy';
            const lineAllocations = line.id ? (allocationsByLine[key] || []) : [];
            const lineRecords = line.id ? (recordsByLine[key] || []) : recordsResult.rows;
            const pickedQuantity = lineRecords
                .filter((record) => record.status === 'picked')
                .reduce((sum, record) => sum + Number(record.picked_quantity || 0), 0);
            const ngScanCount = lineRecords.filter((record) => record.status !== 'picked').length;
            return {
                ...line,
                allocations: lineAllocations,
                records: lineRecords,
                allocated_quantity: lineAllocations.reduce((sum, allocation) => sum + Number(allocation.shipped_quantity || 0), 0),
                picked_quantity: pickedQuantity,
                ng_scan_count: ngScanCount
            };
        });

        const auditResult = await pool.query(`
            SELECT ae.*, p.product_code, p.product_name
            FROM shipping_audit_events ae
            LEFT JOIN products p ON p.id = ae.product_id
            WHERE ae.shipping_instruction_id = $1
            ORDER BY ae.occurred_at DESC, ae.id DESC
            LIMIT 300
        `, [id]);
        const completion = await loadShipmentCompletionStatus(pool, id);

        res.json({
            shipping,
            lines,
            allocations: allocationsResult.rows,
            picking,
            packing,
            records: recordsResult.rows,
            audit_events: auditResult.rows,
            completion
        });
    } catch (error) {
        logger.error('Error fetching shipping instruction history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示の明細(製品)一覧 + 進捗(指示数/出荷済み)
router.get('/:id/lines', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT l.id, l.shipping_instruction_id, l.product_id, l.quantity,
                   l.shipped_quantity, l.status,
                   p.product_code, p.product_name,
                   (l.quantity - l.shipped_quantity) AS remaining_quantity
            FROM shipping_instruction_lines l
            JOIN products p ON p.id = l.product_id
            WHERE l.shipping_instruction_id = $1
            ORDER BY l.id
        `, [id]);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching shipping instruction lines:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 明細の追加(1指示にN製品)
router.post('/:id/lines', async (req, res) => {
    try {
        const { id } = req.params;
        const { product_id, quantity } = req.body;
        if (!product_id || !quantity || quantity <= 0) {
            return res.status(400).json({ error: 'product_id と正の quantity が必要です' });
        }
        const result = await pool.query(`
            INSERT INTO shipping_instruction_lines (shipping_instruction_id, product_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (shipping_instruction_id, product_id)
            DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [id, product_id, quantity]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        logger.error('Error adding shipping instruction line:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 明細の削除(出荷済みがある場合は拒否)
router.delete('/lines/:lineId', async (req, res) => {
    try {
        const { lineId } = req.params;
        const line = await pool.query('SELECT * FROM shipping_instruction_lines WHERE id = $1', [lineId]);
        if (line.rows.length === 0) return res.status(404).json({ error: 'Line not found' });
        if (line.rows[0].shipped_quantity > 0) {
            return res.status(409).json({ error: '出荷済みの明細は削除できません(先に割り当てを取り消してください)' });
        }
        await pool.query('DELETE FROM shipping_instruction_lines WHERE id = $1', [lineId]);
        res.json({ success: true });
    } catch (error) {
        logger.error('Error deleting shipping instruction line:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 出荷指示の進捗集計(明細合計から算出)
router.get('/:id/progress', async (req, res) => {
    try {
        const { id } = req.params;
        const r = await pool.query(`
            SELECT
                COUNT(*)::int AS line_count,
                COALESCE(SUM(quantity),0)::int AS total_quantity,
                COALESCE(SUM(shipped_quantity),0)::int AS shipped_quantity,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_lines
            FROM shipping_instruction_lines
            WHERE shipping_instruction_id = $1
        `, [id]);
        const row = r.rows[0];
        const pct = row.total_quantity > 0
            ? Math.round(row.shipped_quantity / row.total_quantity * 100) : 0;
        const status = row.line_count === 0 ? 'none'
            : (row.completed_lines === row.line_count ? 'completed'
               : (row.shipped_quantity > 0 ? 'partial' : 'pending'));
        res.json({ ...row, percent: pct, status });
    } catch (error) {
        logger.error('Error fetching instruction progress:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
