/**
 * picking-instructions API ルーター(server.js から抽出、振る舞い不変)
 * マウント: /picking-instructions と /api/picking-instructions
 */
const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');
const Joi = require('joi');
const { recordAuditEvent } = require('../lib/audit');

const router = express.Router();

async function getPpsSchemaCapabilities(clientOrPool = pool) {
    try {
        const result = await clientOrPool.query(`
            SELECT
                to_regclass('public.qr_units') IS NOT NULL AS has_qr_units,
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'picking_records'
                      AND column_name = 'qr_code'
                ) AS has_picking_qr_code,
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'picking_records'
                      AND column_name = 'scan_source'
                ) AS has_picking_scan_source
        `);
        return result.rows[0];
    } catch (error) {
        logger.warn('PPS schema capability check failed, falling back to lot-number mode:', error.message);
        return { has_qr_units: false, has_picking_qr_code: false, has_picking_scan_source: false };
    }
}

async function getShippingLineTotal(clientOrPool, shippingInstructionId) {
    const lineTotal = await clientOrPool.query(`
        SELECT COALESCE(SUM(quantity), 0)::int AS total_quantity
        FROM shipping_instruction_lines
        WHERE shipping_instruction_id = $1
    `, [shippingInstructionId]);
    return Number(lineTotal.rows[0]?.total_quantity || 0);
}

async function getActiveAllocationTotal(clientOrPool, shippingInstructionId) {
    const allocationTotal = await clientOrPool.query(`
        SELECT COALESCE(SUM(a.shipped_quantity), 0)::int AS total_quantity
        FROM shipping_lot_allocations a
        JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
        WHERE l.shipping_instruction_id = $1
          AND a.status = 'shipped'
    `, [shippingInstructionId]);
    return Number(allocationTotal.rows[0]?.total_quantity || 0);
}

async function getPickingRecordsByLot(clientOrPool, pickingInstructionId) {
    const picked = await clientOrPool.query(`
        SELECT product_id, lot_number, COALESCE(SUM(picked_quantity), 0)::int AS picked_quantity
        FROM picking_records
        WHERE picking_instruction_id = $1
          AND status = 'picked'
        GROUP BY product_id, lot_number
    `, [pickingInstructionId]);
    const map = new Map();
    for (const row of picked.rows) {
        map.set(`${row.product_id}:${row.lot_number}`, Number(row.picked_quantity || 0));
    }
    return map;
}

async function getPickedQuantity(clientOrPool, pickingInstructionId, productId, lotNumber, qrCode) {
    const capabilities = await getPpsSchemaCapabilities(clientOrPool);
    const result = capabilities.has_picking_qr_code && qrCode
        ? await clientOrPool.query(`
            SELECT COALESCE(SUM(picked_quantity), 0)::int AS picked_quantity
            FROM picking_records
            WHERE picking_instruction_id = $1
              AND status = 'picked'
              AND qr_code = $2
        `, [pickingInstructionId, qrCode])
        : await clientOrPool.query(`
            SELECT COALESCE(SUM(picked_quantity), 0)::int AS picked_quantity
            FROM picking_records
            WHERE picking_instruction_id = $1
              AND status = 'picked'
              AND product_id = $2
              AND lot_number = $3
        `, [pickingInstructionId, productId, lotNumber]);
    return Number(result.rows[0]?.picked_quantity || 0);
}

async function getActiveAllocations(clientOrPool, shippingInstructionId) {
    const allocations = await clientOrPool.query(`
        SELECT a.id, a.shipping_instruction_line_id, a.lot_inventory_id,
               a.lot_number, a.product_id, a.shipped_quantity,
               l.quantity AS line_quantity,
               p.product_code, p.product_name,
               li.location
        FROM shipping_lot_allocations a
        JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
        JOIN products p ON p.id = a.product_id
        LEFT JOIN lot_inventory li ON li.id = a.lot_inventory_id
        WHERE l.shipping_instruction_id = $1
          AND a.status = 'shipped'
        ORDER BY p.product_code, a.lot_number, a.id
    `, [shippingInstructionId]);
    return allocations.rows;
}

async function resolveQrInput(clientOrPool, inputCode) {
    const capabilities = await getPpsSchemaCapabilities(clientOrPool);
    if (capabilities.has_qr_units) {
        const unit = await clientOrPool.query(`
            SELECT qu.*, li.location, li.quantity AS lot_quantity
            FROM qr_units qu
            LEFT JOIN lot_inventory li ON li.id = qu.lot_inventory_id
            WHERE qu.qr_code = $1
              AND COALESCE(qu.status, 'available') NOT IN ('cancelled','lost','invalid')
            LIMIT 1
        `, [inputCode]);
        if (unit.rows.length > 0) {
            return {
                input_code: inputCode,
                qr_code: unit.rows[0].qr_code,
                lot_number: unit.rows[0].lot_number,
                product_id: unit.rows[0].product_id,
                lot_inventory_id: unit.rows[0].lot_inventory_id,
                location: unit.rows[0].location,
                source: 'qr_unit',
                unit: unit.rows[0]
            };
        }
    }
    return {
        input_code: inputCode,
        qr_code: capabilities.has_picking_qr_code ? inputCode : null,
        lot_number: inputCode,
        product_id: null,
        lot_inventory_id: null,
        location: null,
        source: 'lot_number_compat',
        unit: null
    };
}

async function insertPickingRecord(clientOrPool, fields) {
    const capabilities = await getPpsSchemaCapabilities(clientOrPool);
    const columns = ['picking_instruction_id', 'lot_number', 'product_id', 'picked_quantity', 'status', 'error_message'];
    const values = [
        fields.picking_instruction_id,
        fields.lot_number,
        fields.product_id || null,
        fields.picked_quantity,
        fields.status || 'picked',
        fields.error_message || null
    ];
    if (fields.lot_inventory_id !== undefined) {
        columns.splice(1, 0, 'lot_inventory_id');
        values.splice(1, 0, fields.lot_inventory_id || null);
    }
    if (fields.location !== undefined) {
        columns.push('location');
        values.push(fields.location || null);
    }
    if (capabilities.has_picking_qr_code) {
        columns.push('qr_code');
        values.push(fields.qr_code || null);
    }
    if (capabilities.has_picking_scan_source) {
        columns.push('scan_source');
        values.push(fields.scan_source || 'lot_number_compat');
    }
    const placeholders = values.map((_, index) => `$${index + 1}`).join(',');
    const result = await clientOrPool.query(`
        INSERT INTO picking_records (${columns.join(', ')})
        VALUES (${placeholders}) RETURNING *
    `, values);
    return result.rows[0];
}

function enrichNgMessage(baseMessage, value) {
    const reason = value.ng_reason_code ? `理由:${value.ng_reason_code}` : '';
    const comment = value.ng_comment ? `コメント:${value.ng_comment}` : '';
    return [baseMessage, reason, comment].filter(Boolean).join(' / ');
}

function effectiveReason(defaultReason, value) {
    return value.ng_reason_code || defaultReason;
}

function effectiveComment(defaultComment, value) {
    return value.ng_comment
        ? `${defaultComment} / ${value.ng_comment}`
        : defaultComment;
}

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

        const allocatedQuantity = await getActiveAllocationTotal(pool, shipping_instruction_id);
        const lineQuantity = await getShippingLineTotal(pool, shipping_instruction_id);
        const totalQuantity = allocatedQuantity || lineQuantity || si.quantity;

        const pickingId = `PICK-${si.instruction_id}-${Date.now().toString().slice(-4)}`;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`
                INSERT INTO picking_instructions
                  (picking_id, shipping_instruction_id, picker_name, total_quantity, notes)
                VALUES ($1,$2,$3,$4,$5) RETURNING *
            `, [pickingId, shipping_instruction_id, picker_name || null, totalQuantity, notes || null]);
            await client.query(
                `UPDATE shipping_instructions SET status='picking', updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
                [shipping_instruction_id]
            );
            await recordAuditEvent(client, req, {
                shipping_instruction_id,
                event_type: 'pps_started',
                event_status: 'success',
                quantity: totalQuantity,
                after_data: {
                    picking_instruction_id: result.rows[0].id,
                    picking_id: result.rows[0].picking_id,
                    picker_name: picker_name || null,
                    total_quantity: totalQuantity
                },
                comment: 'PPS ピッキング指示を作成'
            });
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
            SELECT pi.*, si.instruction_id, si.customer_name, si.quantity as ordered_qty
            FROM picking_instructions pi
            JOIN shipping_instructions si ON pi.shipping_instruction_id = si.id
            WHERE pi.id = $1
        `, [id]);
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Picking instruction not found' });

        const records = await pool.query(`
            SELECT pr.*, li.location as lot_location, p.product_code, p.product_name
            FROM picking_records pr
            LEFT JOIN lot_inventory li ON pr.lot_inventory_id = li.id
            LEFT JOIN products p ON pr.product_id = p.id
            WHERE pr.picking_instruction_id = $1
            ORDER BY pr.scanned_at
        `, [id]);
        const lines = await pool.query(`
            SELECT l.id, l.product_id, l.quantity, l.shipped_quantity, l.status,
                   p.product_code, p.product_name
            FROM shipping_instruction_lines l
            JOIN products p ON p.id = l.product_id
            WHERE l.shipping_instruction_id = $1
            ORDER BY l.id
        `, [piResult.rows[0].shipping_instruction_id]);

        res.json({ picking: piResult.rows[0], lines: lines.rows, records: records.rows });
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
// ロット引当がある場合は shipping_lot_allocations を正として照合する。
// 引当がない既存単一品目データは shipping_instructions.product_id 互換で処理する。
router.post('/:id/scan', async (req, res) => {
    try {
        const { id } = req.params;
        const { error, value } = Joi.object({
            lot_number: Joi.string().max(255).allow('', null),
            qr_code: Joi.string().max(255).allow('', null),
            picked_quantity: Joi.number().integer().min(1).default(1),
            ng_reason_code: Joi.string().max(100).allow('', null),
            ng_comment: Joi.string().max(500).allow('', null)
        }).or('lot_number', 'qr_code').validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const inputCode = (value.qr_code || value.lot_number || '').trim();
        const { picked_quantity } = value;
        if (!inputCode) return res.status(400).json({ error: 'lot_number または qr_code が必要です' });

        // ピッキング指示取得
        const piResult = await pool.query(
            `SELECT pi.*, si.product_id, si.id AS shipping_instruction_id
             FROM picking_instructions pi
             JOIN shipping_instructions si ON pi.shipping_instruction_id = si.id
             WHERE pi.id = $1`, [id]
        );
        if (piResult.rows.length === 0) return res.status(404).json({ error: 'Picking instruction not found' });
        const pi = piResult.rows[0];
        if (!['pending','in_progress'].includes(pi.status)) {
            return res.status(409).json({ error: `ステータス ${pi.status} のためスキャンできません` });
        }

        const resolvedScan = await resolveQrInput(pool, inputCode);
        const allocations = await getActiveAllocations(pool, pi.shipping_instruction_id);
        let lot = null;
        let productId = resolvedScan.product_id || pi.product_id;
        let allocation = null;
        let allocationRemaining = null;
        let lotNumber = resolvedScan.lot_number;

        if (allocations.length > 0) {
            const candidates = allocations.filter((a) =>
                a.lot_number === lotNumber &&
                (!resolvedScan.product_id || Number(a.product_id) === Number(resolvedScan.product_id))
            );
            if (candidates.length === 0) {
                await insertPickingRecord(pool, {
                    picking_instruction_id: id,
                    lot_number: lotNumber || inputCode,
                    product_id: productId,
                    picked_quantity,
                    status: 'error',
                    error_message: enrichNgMessage('未引当ロットまたは別品目です', value),
                    qr_code: resolvedScan.qr_code,
                    scan_source: resolvedScan.source
                });
                await recordAuditEvent(pool, req, {
                    shipping_instruction_id: pi.shipping_instruction_id,
                    event_type: 'qr_scan_ng',
                    event_status: 'ng',
                    product_id: productId,
                    lot_number: lotNumber || inputCode,
                    qr_code: resolvedScan.qr_code,
                    quantity: picked_quantity,
                    reason_code: effectiveReason('unallocated_lot', value),
                    after_data: { resolved_scan: resolvedScan },
                    comment: effectiveComment('未引当ロットまたは別品目', value)
                });
                return res.json({
                    success: false,
                    code: 'unallocated_lot',
                    message: '未引当ロットまたは別品目です。検品数量には加算しません。'
                });
            }

            allocation = candidates.find((a) => {
                // QR 個体 ID は重複判定、ロットは残数量判定に使う。
                // 同一ロット内の別 QR まで重複扱いにしない。
                const alreadyPicked = 0;
                return alreadyPicked < Number(a.shipped_quantity || 0);
            }) || candidates[0];
            productId = allocation.product_id;
            lotNumber = allocation.lot_number;
            const alreadyPickedForLot = await getPickedQuantity(pool, id, productId, lotNumber, null);
            const alreadyPickedForQr = resolvedScan.source === 'qr_unit' && resolvedScan.qr_code
                ? await getPickedQuantity(pool, id, productId, lotNumber, resolvedScan.qr_code)
                : alreadyPickedForLot;
            allocationRemaining = Math.max(0, Number(allocation.shipped_quantity || 0) - alreadyPickedForLot);

            if (alreadyPickedForQr > 0) {
                await insertPickingRecord(pool, {
                    picking_instruction_id: id,
                    lot_number: lotNumber,
                    product_id: productId,
                    picked_quantity: 0,
                    status: 'duplicate',
                    error_message: enrichNgMessage('二重スキャンのため追加カウントしません', value),
                    qr_code: resolvedScan.qr_code,
                    scan_source: resolvedScan.source
                });
                await recordAuditEvent(pool, req, {
                    shipping_instruction_id: pi.shipping_instruction_id,
                    line_id: allocation.shipping_instruction_line_id,
                    allocation_id: allocation.id,
                    event_type: 'qr_scan_duplicate',
                    event_status: 'duplicate',
                    product_id: productId,
                    lot_id: allocation.lot_inventory_id,
                    lot_number: lotNumber,
                    qr_code: resolvedScan.qr_code,
                    quantity: 0,
                    reason_code: effectiveReason('duplicate_scan', value),
                    after_data: { resolved_scan: resolvedScan },
                    comment: effectiveComment('二重スキャンのため追加カウントしません', value)
                });
                return res.json({
                    success: false,
                    code: 'duplicate_scan',
                    message: '二重スキャンです。追加カウントしません。',
                    picked_quantity: pi.picked_quantity,
                    total_quantity: pi.total_quantity,
                    allocation
                });
            }

            if (picked_quantity > allocationRemaining) {
                await insertPickingRecord(pool, {
                    picking_instruction_id: id,
                    lot_number: lotNumber,
                    product_id: productId,
                    picked_quantity,
                    status: 'error',
                    error_message: enrichNgMessage(`残引当数量(${allocationRemaining})を超えています`, value),
                    qr_code: resolvedScan.qr_code,
                    scan_source: resolvedScan.source
                });
                await recordAuditEvent(pool, req, {
                    shipping_instruction_id: pi.shipping_instruction_id,
                    line_id: allocation.shipping_instruction_line_id,
                    allocation_id: allocation.id,
                    event_type: 'qr_scan_ng',
                    event_status: 'ng',
                    product_id: productId,
                    lot_id: allocation.lot_inventory_id,
                    lot_number: lotNumber,
                    qr_code: resolvedScan.qr_code,
                    quantity: picked_quantity,
                    reason_code: effectiveReason('quantity_exceeded', value),
                    after_data: { remaining_quantity: allocationRemaining, resolved_scan: resolvedScan },
                    comment: effectiveComment(`残引当数量(${allocationRemaining})を超えています`, value)
                });
                return res.json({
                    success: false,
                    code: 'quantity_exceeded',
                    message: `残引当数量(${allocationRemaining})を超えています`,
                    remaining_quantity: allocationRemaining
                });
            }

            const lotResult = await pool.query(
                `SELECT * FROM lot_inventory WHERE lot_number=$1 AND product_id=$2`,
                [lotNumber, productId]
            );
            lot = lotResult.rows[0] || { id: allocation.lot_inventory_id, location: allocation.location };
        } else {
            // 互換モード: 既存単一品目データは製品ロットだけで照合する。
            const legacyRemaining = Math.max(0, Number(pi.total_quantity || 0) - Number(pi.picked_quantity || 0));
            if (picked_quantity > legacyRemaining) {
                await insertPickingRecord(pool, {
                    picking_instruction_id: id,
                    lot_number: lotNumber || inputCode,
                    product_id: productId,
                    picked_quantity,
                    status: 'error',
                    error_message: enrichNgMessage(`残数量(${legacyRemaining})を超えています`, value),
                    qr_code: resolvedScan.qr_code,
                    scan_source: resolvedScan.source
                });
                await recordAuditEvent(pool, req, {
                    shipping_instruction_id: pi.shipping_instruction_id,
                    event_type: 'qr_scan_ng',
                    event_status: 'ng',
                    product_id: productId,
                    lot_number: lotNumber || inputCode,
                    qr_code: resolvedScan.qr_code,
                    quantity: picked_quantity,
                    reason_code: effectiveReason('quantity_exceeded', value),
                    after_data: { remaining_quantity: legacyRemaining, resolved_scan: resolvedScan },
                    comment: effectiveComment(`残数量(${legacyRemaining})を超えています`, value)
                });
                return res.json({
                    success: false,
                    code: 'quantity_exceeded',
                    message: `残数量(${legacyRemaining})を超えています`,
                    remaining_quantity: legacyRemaining
                });
            }
            const lotResult = await pool.query(
                `SELECT * FROM lot_inventory WHERE lot_number=$1 AND product_id=$2`,
                [lotNumber, productId]
            );
            if (lotResult.rows.length === 0) {
                await insertPickingRecord(pool, {
                    picking_instruction_id: id,
                    lot_number: lotNumber || inputCode,
                    product_id: productId,
                    picked_quantity,
                    status: 'error',
                    error_message: enrichNgMessage('対象製品のロットが見つかりません', value),
                    qr_code: resolvedScan.qr_code,
                    scan_source: resolvedScan.source
                });
                await recordAuditEvent(pool, req, {
                    shipping_instruction_id: pi.shipping_instruction_id,
                    event_type: 'qr_scan_ng',
                    event_status: 'ng',
                    product_id: productId,
                    lot_number: lotNumber || inputCode,
                    qr_code: resolvedScan.qr_code,
                    quantity: picked_quantity,
                    reason_code: effectiveReason('lot_not_found', value),
                    after_data: { resolved_scan: resolvedScan },
                    comment: effectiveComment('対象製品のロットが見つかりません', value)
                });
                return res.json({ success: false, code: 'lot_not_found', message: '対象製品のロットが見つかりません' });
            }

            const alreadyPicked = await getPickedQuantity(
                pool,
                id,
                productId,
                lotNumber,
                resolvedScan.source === 'qr_unit' ? resolvedScan.qr_code : null
            );
            if (alreadyPicked > 0) {
                await insertPickingRecord(pool, {
                    picking_instruction_id: id,
                    lot_number: lotNumber,
                    product_id: productId,
                    picked_quantity: 0,
                    status: 'duplicate',
                    error_message: enrichNgMessage('二重スキャンのため追加カウントしません', value),
                    qr_code: resolvedScan.qr_code,
                    scan_source: resolvedScan.source
                });
                await recordAuditEvent(pool, req, {
                    shipping_instruction_id: pi.shipping_instruction_id,
                    event_type: 'qr_scan_duplicate',
                    event_status: 'duplicate',
                    product_id: productId,
                    lot_id: lotResult.rows[0].id,
                    lot_number: lotNumber,
                    qr_code: resolvedScan.qr_code,
                    quantity: 0,
                    reason_code: effectiveReason('duplicate_scan', value),
                    after_data: { resolved_scan: resolvedScan },
                    comment: effectiveComment('二重スキャンのため追加カウントしません', value)
                });
                return res.json({
                    success: false,
                    code: 'duplicate_scan',
                    message: '二重スキャンです。追加カウントしません。',
                    picked_quantity: pi.picked_quantity,
                    total_quantity: pi.total_quantity
                });
            }

            lot = lotResult.rows[0];
            if (lot.quantity < picked_quantity) {
                await insertPickingRecord(pool, {
                    picking_instruction_id: id,
                    lot_number: lotNumber,
                    product_id: productId,
                    picked_quantity,
                    status: 'error',
                    error_message: enrichNgMessage(`在庫不足 (在庫: ${lot.quantity})`, value),
                    qr_code: resolvedScan.qr_code,
                    scan_source: resolvedScan.source
                });
                await recordAuditEvent(pool, req, {
                    shipping_instruction_id: pi.shipping_instruction_id,
                    event_type: 'qr_scan_ng',
                    event_status: 'ng',
                    product_id: productId,
                    lot_id: lot.id,
                    lot_number: lotNumber,
                    qr_code: resolvedScan.qr_code,
                    quantity: picked_quantity,
                    reason_code: effectiveReason('stock_shortage', value),
                    after_data: { lot_quantity: lot.quantity, resolved_scan: resolvedScan },
                    comment: effectiveComment(`在庫不足 (在庫: ${lot.quantity})`, value)
                });
                return res.json({ success: false, code: 'stock_shortage', message: `在庫不足です (在庫: ${lot.quantity})` });
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // ピッキング記録
            const record = await insertPickingRecord(client, {
                picking_instruction_id: id,
                lot_inventory_id: lot.id || null,
                lot_number: lotNumber,
                product_id: productId,
                picked_quantity,
                status: 'picked',
                location: lot.location || null,
                qr_code: resolvedScan.qr_code,
                scan_source: resolvedScan.source
            });

            // ピッキング済み数量を更新
            const newPicked = parseInt(pi.picked_quantity) + picked_quantity;
            await client.query(`
                UPDATE picking_instructions
                SET picked_quantity=$1, status='in_progress', updated_at=CURRENT_TIMESTAMP
                WHERE id=$2
            `, [newPicked, id]);
            await recordAuditEvent(client, req, {
                shipping_instruction_id: pi.shipping_instruction_id,
                line_id: allocation ? allocation.shipping_instruction_line_id : null,
                allocation_id: allocation ? allocation.id : null,
                event_type: 'qr_scan_ok',
                event_status: 'success',
                product_id: productId,
                lot_id: lot.id || (allocation ? allocation.lot_inventory_id : null),
                lot_number: lotNumber,
                qr_code: resolvedScan.qr_code,
                quantity: picked_quantity,
                before_data: {
                    picked_quantity: pi.picked_quantity
                },
                after_data: {
                    picked_quantity: newPicked,
                    total_quantity: pi.total_quantity,
                    resolved_scan: resolvedScan
                },
                comment: 'QR / ロットスキャンを検品 OK として記録'
            });

            await client.query('COMMIT');
            res.json({
                success: true,
                code: 'picked',
                message: `${resolvedScan.source === 'qr_unit' ? 'QR' : 'ロット'} ${inputCode} をピッキングしました`,
                record,
                picked_quantity: newPicked,
                total_quantity: pi.total_quantity,
                allocation,
                resolved_scan: resolvedScan,
                remaining_quantity: allocationRemaining === null ? null : allocationRemaining - picked_quantity
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

// 直前スキャン取り消し。PPS 完了前の OK スキャンだけ数量を戻す。
router.delete('/:id/records/:recordId', async (req, res) => {
    const client = await pool.connect();
    try {
        const { id, recordId } = req.params;
        await client.query('BEGIN');

        const piResult = await client.query(`
            SELECT pi.*, si.status AS shipping_status
            FROM picking_instructions pi
            JOIN shipping_instructions si ON si.id = pi.shipping_instruction_id
            WHERE pi.id = $1
            FOR UPDATE OF pi
        `, [id]);
        if (piResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Picking instruction not found' });
        }
        const pi = piResult.rows[0];
        if (['packing', 'inspecting', 'shipped', 'delivered'].includes(pi.shipping_status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'PPS 開始後の通常取消はピッキング中のみ可能です。梱包以降または出荷完了後は理由付きの完了後修正を使用してください'
            });
        }
        if (!['pending', 'in_progress'].includes(pi.status)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: `ステータス ${pi.status} のため取り消しできません` });
        }

        const recordResult = await client.query(`
            SELECT *
            FROM picking_records
            WHERE id = $1
              AND picking_instruction_id = $2
            FOR UPDATE
        `, [recordId, id]);
        if (recordResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Picking record not found' });
        }
        const record = recordResult.rows[0];
        if (record.status !== 'picked' || Number(record.picked_quantity || 0) <= 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '数量加算済みの OK スキャンのみ取り消しできます' });
        }

        await client.query('DELETE FROM picking_records WHERE id = $1', [record.id]);
        const nextPicked = Math.max(0, Number(pi.picked_quantity || 0) - Number(record.picked_quantity || 0));
        await client.query(`
            UPDATE picking_instructions
            SET picked_quantity = $1,
                status = 'in_progress',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [nextPicked, id]);
        await recordAuditEvent(client, req, {
            shipping_instruction_id: pi.shipping_instruction_id,
            event_type: 'qr_scan_cancelled',
            event_status: 'success',
            product_id: record.product_id,
            lot_id: record.lot_inventory_id,
            lot_number: record.lot_number,
            qr_code: record.qr_code,
            quantity: record.picked_quantity,
            before_data: {
                picked_quantity: pi.picked_quantity,
                record
            },
            after_data: {
                picked_quantity: nextPicked
            },
            reason_code: 'scan_undo',
            comment: '直前 QR / ロットスキャンを取り消し'
        });

        await client.query('COMMIT');
        res.json({
            success: true,
            cancelled_record: record,
            picked_quantity: nextPicked,
            total_quantity: pi.total_quantity
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error cancelling picking record:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
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
            const allocatedQuantity = await getActiveAllocationTotal(client, pi.shipping_instruction_id);
            if (allocatedQuantity === 0) {
                // 互換モードのみ在庫をここで減算する。新設計の引当済みデータは数量確定時に減算済み。
                const records = await client.query(
                    `SELECT product_id, lot_number, SUM(picked_quantity) as qty FROM picking_records
                     WHERE picking_instruction_id=$1 AND status='picked'
                     GROUP BY product_id, lot_number`, [id]
                );
                for (const r of records.rows) {
                    await client.query(
                        `UPDATE lot_inventory SET quantity = quantity - $1, updated_at=CURRENT_TIMESTAMP
                         WHERE lot_number=$2 AND product_id=$3 AND quantity >= $1`,
                        [parseInt(r.qty), r.lot_number, r.product_id]
                    );
                }
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
            await recordAuditEvent(client, req, {
                shipping_instruction_id: pi.shipping_instruction_id,
                event_type: 'picking_completed',
                event_status: 'success',
                quantity: pi.picked_quantity,
                before_data: {
                    picking_status: pi.status,
                    shipping_status: 'picking'
                },
                after_data: {
                    picking_status: 'completed',
                    shipping_status: 'packing',
                    picked_quantity: pi.picked_quantity,
                    total_quantity: pi.total_quantity
                },
                comment: 'ピッキングを完了'
            });
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
