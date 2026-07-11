const express = require('express');
const Joi = require('joi');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

const importSchema = Joi.object({
    document_no: Joi.string().max(80).required(),
    document_type: Joi.string().valid('sales_order', 'delivery_note').required(),
    source_engine: Joi.string().max(80).default('manual'),
    source_file_name: Joi.string().max(255).allow('', null),
    raw_text: Joi.string().required(),
    confidence: Joi.number().min(0).max(100).allow(null),
    notes: Joi.string().allow('', null)
});

const createSalesOrderSchema = Joi.object({
    shipping_location_id: Joi.number().integer().allow(null),
    delivery_location_id: Joi.number().integer().allow(null),
    priority: Joi.string().valid('high', 'normal', 'low').default('normal')
});

function normalizeText(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function extractHeader(text, documentNo) {
    const normalized = normalizeText(text);
    const orderNo = matchFirst(normalized, [
        /(?:注文番号|受注番号|発注番号)\s*[:：]\s*([A-Z0-9-]+)/i,
        /\bPO\s*[:：#-]\s*([A-Z0-9-]+)/i,
        /\bOrder\s*[:：#-]?\s*([A-Z0-9-]+)/i,
        /(?:納品書番号|納品番号)\s*[:：]\s*([A-Z0-9-]+)/i,
        /\bDN\s*[:：#-]\s*([A-Z0-9-]+)/i
    ]) || documentNo;
    const customerName = matchFirst(normalized, [
        /(?:顧客名|得意先|納品先|Customer)\s*[:：]?\s*(.+)/i
    ]) || 'OCR 顧客';
    const supplierName = matchFirst(normalized, [
        /(?:仕入先|発注先|Supplier)\s*[:：]?\s*(.+)/i
    ]) || null;
    const date = matchFirst(normalized, [
        /(?:希望出荷日|出荷日|納品日|日付)\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i
    ]);
    return {
        order_no: orderNo,
        customer_name: cleanName(customerName),
        supplier_name: supplierName ? cleanName(supplierName) : null,
        requested_ship_date: date ? date.replace(/\//g, '-') : null
    };
}

function matchFirst(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }
    return null;
}

function cleanName(value) {
    return String(value || '').split('\n')[0].trim();
}

function parseLines(text) {
    return normalizeText(text)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = line.match(/\b([A-Z]{2,}[A-Z0-9-]*)\b\s+(.+?)\s+(\d+)(?:\s+([0-9.]+))?$/i);
            if (!match) return null;
            return {
                product_code: match[1].toUpperCase(),
                product_name: match[2].trim(),
                quantity: Number(match[3]),
                unit_price: match[4] ? Number(match[4]) : null,
                raw_line: line
            };
        })
        .filter((line) => line && line.quantity > 0);
}

async function enrichLines(client, lines) {
    const enriched = [];
    for (const line of lines) {
        const product = await client.query(
            'SELECT id, product_code, product_name FROM products WHERE product_code = $1 LIMIT 1',
            [line.product_code],
        );
        enriched.push({
            ...line,
            product_id: product.rows[0]?.id || null,
            product_name: product.rows[0]?.product_name || line.product_name,
            match_status: product.rows[0] ? 'matched' : 'unmatched'
        });
    }
    return enriched;
}

router.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT d.*,
                   COUNT(l.id)::int AS line_count,
                   COUNT(l.id) FILTER (WHERE l.match_status = 'matched')::int AS matched_lines
            FROM ocr_documents d
            LEFT JOIN ocr_document_lines l ON l.ocr_document_id = d.id
            GROUP BY d.id
            ORDER BY d.created_at DESC, d.id DESC
        `);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error fetching OCR imports:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const document = await pool.query('SELECT * FROM ocr_documents WHERE id = $1', [req.params.id]);
        if (!document.rows.length) return res.status(404).json({ error: 'OCR document not found' });
        const lines = await pool.query(`
            SELECT l.*, p.product_code AS matched_product_code, p.product_name AS matched_product_name
            FROM ocr_document_lines l
            LEFT JOIN products p ON p.id = l.product_id
            WHERE l.ocr_document_id = $1
            ORDER BY l.line_no
        `, [req.params.id]);
        const matches = await pool.query('SELECT * FROM ocr_business_matches WHERE ocr_document_id = $1 ORDER BY match_score DESC, id', [req.params.id]);
        res.json({ document: document.rows[0], lines: lines.rows, matches: matches.rows });
    } catch (error) {
        logger.error('Error fetching OCR import:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = importSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        const normalized = normalizeText(value.raw_text);
        const header = extractHeader(normalized, value.document_no);
        const parsedLines = await enrichLines(client, parseLines(normalized));

        await client.query('BEGIN');
        const document = await client.query(`
            INSERT INTO ocr_documents
              (document_no, document_type, source_engine, source_file_name, raw_text,
               normalized_text, confidence, extraction_status, extracted_data, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'parsed',$8::jsonb,$9)
            RETURNING *
        `, [value.document_no, value.document_type, value.source_engine || 'manual',
            value.source_file_name || null, value.raw_text, normalized, value.confidence || null,
            JSON.stringify(header), value.notes || null]);

        const insertedLines = [];
        let lineNo = 1;
        for (const line of parsedLines) {
            const inserted = await client.query(`
                INSERT INTO ocr_document_lines
                  (ocr_document_id, line_no, product_code, product_name, product_id,
                   quantity, unit_price, amount, raw_line, match_status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                RETURNING *
            `, [document.rows[0].id, lineNo++, line.product_code, line.product_name, line.product_id,
                line.quantity, line.unit_price, line.unit_price ? line.unit_price * line.quantity : null,
                line.raw_line, line.match_status]);
            insertedLines.push(inserted.rows[0]);
        }

        if (value.document_type === 'delivery_note') {
            await createDeliveryNoteMatches(client, document.rows[0].id, insertedLines, header);
        }

        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('ocr','ocr_document_imported','success','ocr_document',$1,$2::jsonb,$3)
        `, [document.rows[0].id, JSON.stringify({ document_type: value.document_type, line_count: insertedLines.length }), value.notes || 'OCR 文書を取込']);
        await client.query('COMMIT');
        res.status(201).json({ document: document.rows[0], lines: insertedLines });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error importing OCR document:', error);
        if (error.code === '23505') return res.status(409).json({ error: 'OCR文書番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

async function createDeliveryNoteMatches(client, documentId, lines, header) {
    const purchaseOrders = await client.query(`
        SELECT po.id, po.purchase_order_no, s.supplier_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE po.status NOT IN ('cancelled','closed')
        ORDER BY po.created_at DESC
        LIMIT 20
    `);
    for (const line of lines) {
        if (!line.product_id) continue;
        const poLines = await client.query(`
            SELECT pol.*, po.purchase_order_no
            FROM purchase_order_lines pol
            JOIN purchase_orders po ON po.id = pol.purchase_order_id
            WHERE pol.product_id = $1
              AND pol.received_quantity < pol.ordered_quantity
            ORDER BY po.created_at DESC
            LIMIT 10
        `, [line.product_id]);
        for (const poLine of poLines.rows) {
            const orderNoScore = header.order_no && poLine.purchase_order_no.includes(header.order_no) ? 40 : 0;
            const quantityScore = Number(line.quantity) <= Number(poLine.ordered_quantity) - Number(poLine.received_quantity) ? 40 : 20;
            await client.query(`
                INSERT INTO ocr_business_matches
                  (ocr_document_id, ocr_document_line_id, match_type, target_type, target_id,
                   target_line_id, match_score, match_status, match_data)
                VALUES ($1,$2,'delivery_note_purchase_line','purchase_order',$3,$4,$5,'candidate',$6::jsonb)
            `, [documentId, line.id, poLine.purchase_order_id, poLine.id, orderNoScore + quantityScore + 20,
                JSON.stringify({ purchase_order_no: poLine.purchase_order_no, ocr_quantity: line.quantity })]);
        }
    }
    if (purchaseOrders.rows.length && !lines.some((line) => line.product_id)) {
        await client.query(`
            INSERT INTO ocr_business_matches
              (ocr_document_id, match_type, target_type, target_id, match_score, match_status, match_data)
            VALUES ($1,'delivery_note_purchase_order','purchase_order',$2,20,'candidate',$3::jsonb)
        `, [documentId, purchaseOrders.rows[0].id, JSON.stringify(purchaseOrders.rows[0])]);
    }
}

router.post('/:id/create-sales-order', async (req, res) => {
    const client = await pool.connect();
    try {
        const { error, value } = createSalesOrderSchema.validate(req.body || {});
        if (error) return res.status(400).json({ error: error.details[0].message });

        await client.query('BEGIN');
        const document = await client.query('SELECT * FROM ocr_documents WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!document.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'OCR document not found' });
        }
        if (document.rows[0].document_type !== 'sales_order') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '受注作成できる文書種別ではありません' });
        }
        if (document.rows[0].linked_source_type === 'sales_order') {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '既に受注作成済みです', sales_order_id: document.rows[0].linked_source_id });
        }
        const lines = await client.query(`
            SELECT *
            FROM ocr_document_lines
            WHERE ocr_document_id = $1 AND product_id IS NOT NULL AND quantity > 0
            ORDER BY line_no
        `, [req.params.id]);
        if (!lines.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: '受注作成できる明細がありません' });
        }

        const data = document.rows[0].extracted_data || {};
        const salesOrderNo = data.sales_order_no || data.order_no || `SO-OCR-${document.rows[0].document_no}`;
        const order = await client.query(`
            INSERT INTO sales_orders
              (sales_order_no, customer_name, requested_ship_date, shipping_location_id,
               delivery_location_id, priority, status, notes)
            VALUES ($1,$2,$3,$4,$5,$6,'confirmed',$7)
            RETURNING *
        `, [salesOrderNo, data.customer_name || 'OCR 顧客', data.requested_ship_date || null,
            value.shipping_location_id || null, value.delivery_location_id || null,
            value.priority || 'normal', `OCR文書 ${document.rows[0].document_no} から作成`]);

        const salesLines = [];
        for (const line of lines.rows) {
            const inserted = await client.query(`
                INSERT INTO sales_order_lines
                  (sales_order_id, product_id, ordered_quantity, status, notes)
                VALUES ($1,$2,$3,'confirmed',$4)
                RETURNING *
            `, [order.rows[0].id, line.product_id, line.quantity, `OCR行 ${line.line_no} から作成`]);
            salesLines.push(inserted.rows[0]);
        }
        await client.query(`
            UPDATE ocr_documents
            SET extraction_status='converted', linked_source_type='sales_order',
                linked_source_id=$2, updated_at=CURRENT_TIMESTAMP
            WHERE id=$1
        `, [req.params.id, order.rows[0].id]);
        await client.query(`
            INSERT INTO operation_events (event_domain, event_type, event_status, source_type, source_id, after_data, comment)
            VALUES ('ocr','ocr_sales_order_created','success','ocr_document',$1,$2::jsonb,'OCR文書から受注を作成')
        `, [req.params.id, JSON.stringify({ sales_order_id: order.rows[0].id, line_count: salesLines.length })]);
        await client.query('COMMIT');
        res.status(201).json({ order: order.rows[0], lines: salesLines });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creating sales order from OCR:', error);
        if (error.code === '23505') return res.status(409).json({ error: '受注番号が既に存在します' });
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
