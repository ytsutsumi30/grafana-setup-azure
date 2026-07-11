const express = require('express');
const pool = require('../lib/db');
const logger = require('../lib/logger');

const router = express.Router();

async function loadTraceByLot(lotNumber) {
    const [
        lots,
        qrUnits,
        transactions,
        events,
        receiving,
        manufacturingConsumptions,
        manufacturingReceipts,
        shippingAllocations
    ] = await Promise.all([
        pool.query(`
            SELECT li.*, p.product_code, p.product_name
            FROM lot_inventory li
            JOIN products p ON p.id = li.product_id
            WHERE li.lot_number = $1
            ORDER BY li.id
        `, [lotNumber]),
        pool.query(`
            SELECT qu.*, p.product_code, p.product_name
            FROM qr_units qu
            JOIN products p ON p.id = qu.product_id
            WHERE qu.lot_number = $1
            ORDER BY qu.id
        `, [lotNumber]),
        pool.query(`
            SELECT it.*, p.product_code, p.product_name
            FROM inventory_transactions it
            JOIN products p ON p.id = it.product_id
            WHERE it.lot_number = $1
            ORDER BY it.occurred_at, it.id
        `, [lotNumber]),
        pool.query(`
            SELECT *
            FROM operation_events
            WHERE lot_number = $1
            ORDER BY occurred_at, id
        `, [lotNumber]),
        pool.query(`
            SELECT rr.*, ro.receiving_order_no, po.purchase_order_no, p.product_code, p.product_name
            FROM receiving_results rr
            JOIN receiving_orders ro ON ro.id = rr.receiving_order_id
            LEFT JOIN purchase_orders po ON po.id = ro.purchase_order_id
            JOIN products p ON p.id = rr.product_id
            WHERE rr.lot_number = $1
            ORDER BY rr.received_at, rr.id
        `, [lotNumber]),
        pool.query(`
            SELECT c.*, mo.work_order_no, p.product_code, p.product_name
            FROM manufacturing_material_consumptions c
            JOIN manufacturing_orders mo ON mo.id = c.manufacturing_order_id
            LEFT JOIN products p ON p.id = c.component_product_id
            WHERE c.lot_number = $1
            ORDER BY c.consumed_at, c.id
        `, [lotNumber]),
        pool.query(`
            SELECT r.*, mo.work_order_no, p.product_code, p.product_name
            FROM manufacturing_receipts r
            JOIN manufacturing_orders mo ON mo.id = r.manufacturing_order_id
            JOIN products p ON p.id = r.product_id
            WHERE r.lot_number = $1
            ORDER BY r.received_at, r.id
        `, [lotNumber]),
        pool.query(`
            SELECT a.*, sil.shipping_instruction_id, si.instruction_id, si.customer_name,
                   p.product_code, p.product_name
            FROM shipping_lot_allocations a
            JOIN shipping_instruction_lines sil ON sil.id = a.shipping_instruction_line_id
            JOIN shipping_instructions si ON si.id = sil.shipping_instruction_id
            JOIN products p ON p.id = a.product_id
            WHERE a.lot_number = $1
            ORDER BY a.scanned_at, a.id
        `, [lotNumber])
    ]);

    return {
        lot_number: lotNumber,
        lots: lots.rows,
        qr_units: qrUnits.rows,
        inventory_transactions: transactions.rows,
        operation_events: events.rows,
        receiving_results: receiving.rows,
        manufacturing_consumptions: manufacturingConsumptions.rows,
        manufacturing_receipts: manufacturingReceipts.rows,
        shipping_allocations: shippingAllocations.rows
    };
}

router.get('/lot/:lotNumber', async (req, res) => {
    try {
        res.json(await loadTraceByLot(req.params.lotNumber));
    } catch (error) {
        logger.error('Error tracing lot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/qr/:qrCode', async (req, res) => {
    try {
        const qr = await pool.query(`
            SELECT qu.*, p.product_code, p.product_name
            FROM qr_units qu
            JOIN products p ON p.id = qu.product_id
            WHERE qu.qr_code = $1
            LIMIT 1
        `, [req.params.qrCode]);
        if (!qr.rows.length) return res.status(404).json({ error: 'QR unit not found' });

        const [transactions, events, receiving, manufacturingConsumptions, manufacturingReceipts] = await Promise.all([
            pool.query(`
                SELECT it.*, p.product_code, p.product_name
                FROM inventory_transactions it
                JOIN products p ON p.id = it.product_id
                WHERE it.qr_unit_id = $1
                ORDER BY it.occurred_at, it.id
            `, [qr.rows[0].id]),
            pool.query(`
                SELECT *
                FROM operation_events
                WHERE qr_unit_id = $1 OR qr_code = $2
                ORDER BY occurred_at, id
            `, [qr.rows[0].id, req.params.qrCode]),
            pool.query(`
                SELECT rr.*, ro.receiving_order_no, po.purchase_order_no
                FROM receiving_results rr
                JOIN receiving_orders ro ON ro.id = rr.receiving_order_id
                LEFT JOIN purchase_orders po ON po.id = ro.purchase_order_id
                WHERE rr.qr_unit_id = $1 OR rr.qr_code = $2
                ORDER BY rr.received_at, rr.id
            `, [qr.rows[0].id, req.params.qrCode]),
            pool.query(`
                SELECT c.*, mo.work_order_no
                FROM manufacturing_material_consumptions c
                JOIN manufacturing_orders mo ON mo.id = c.manufacturing_order_id
                WHERE c.qr_unit_id = $1 OR c.qr_code = $2
                ORDER BY c.consumed_at, c.id
            `, [qr.rows[0].id, req.params.qrCode]),
            pool.query(`
                SELECT r.*, mo.work_order_no
                FROM manufacturing_receipts r
                JOIN manufacturing_orders mo ON mo.id = r.manufacturing_order_id
                WHERE r.qr_unit_id = $1 OR r.qr_code = $2
                ORDER BY r.received_at, r.id
            `, [qr.rows[0].id, req.params.qrCode])
        ]);

        res.json({
            qr_code: req.params.qrCode,
            qr_unit: qr.rows[0],
            lot_trace: qr.rows[0].lot_number ? await loadTraceByLot(qr.rows[0].lot_number) : null,
            inventory_transactions: transactions.rows,
            operation_events: events.rows,
            receiving_results: receiving.rows,
            manufacturing_consumptions: manufacturingConsumptions.rows,
            manufacturing_receipts: manufacturingReceipts.rows
        });
    } catch (error) {
        logger.error('Error tracing QR:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/document/:documentNo', async (req, res) => {
    try {
        const documentNo = req.params.documentNo;
        const [
            salesOrders,
            shippingInstructions,
            purchaseOrders,
            receivingOrders,
            manufacturingOrders,
            ocrDocuments
        ] = await Promise.all([
            pool.query(`
                SELECT so.*, COUNT(sol.id)::int AS line_count
                FROM sales_orders so
                LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
                WHERE so.sales_order_no = $1
                GROUP BY so.id
            `, [documentNo]),
            pool.query(`
                SELECT si.*, so.sales_order_no
                FROM shipping_instructions si
                LEFT JOIN sales_orders so ON so.id = si.sales_order_id
                WHERE si.instruction_id = $1 OR so.sales_order_no = $1
                ORDER BY si.id
            `, [documentNo]),
            pool.query(`
                SELECT po.*, s.supplier_code, s.supplier_name
                FROM purchase_orders po
                LEFT JOIN suppliers s ON s.id = po.supplier_id
                WHERE po.purchase_order_no = $1
            `, [documentNo]),
            pool.query(`
                SELECT ro.*, po.purchase_order_no
                FROM receiving_orders ro
                LEFT JOIN purchase_orders po ON po.id = ro.purchase_order_id
                WHERE ro.receiving_order_no = $1 OR po.purchase_order_no = $1
                ORDER BY ro.id
            `, [documentNo]),
            pool.query(`
                SELECT mo.*, p.product_code, p.product_name
                FROM manufacturing_orders mo
                JOIN products p ON p.id = mo.product_id
                WHERE mo.work_order_no = $1
            `, [documentNo]),
            pool.query(`
                SELECT *
                FROM ocr_documents
                WHERE document_no = $1
                   OR linked_source_id IN (
                       SELECT id FROM sales_orders WHERE sales_order_no = $1
                   )
                ORDER BY id
            `, [documentNo])
        ]);

        const sourceIds = [
            ...salesOrders.rows.map((row) => ({ type: 'sales_order', id: row.id })),
            ...shippingInstructions.rows.map((row) => ({ type: 'shipping_instruction', id: row.id })),
            ...purchaseOrders.rows.map((row) => ({ type: 'purchase_order', id: row.id })),
            ...receivingOrders.rows.map((row) => ({ type: 'receiving_order', id: row.id })),
            ...manufacturingOrders.rows.map((row) => ({ type: 'manufacturing_order', id: row.id })),
            ...ocrDocuments.rows.map((row) => ({ type: 'ocr_document', id: row.id }))
        ];

        const events = [];
        for (const source of sourceIds) {
            const result = await pool.query(`
                SELECT *
                FROM operation_events
                WHERE source_type = $1 AND source_id = $2
                ORDER BY occurred_at, id
            `, [source.type, source.id]);
            events.push(...result.rows);
        }

        res.json({
            document_no: documentNo,
            sales_orders: salesOrders.rows,
            shipping_instructions: shippingInstructions.rows,
            purchase_orders: purchaseOrders.rows,
            receiving_orders: receivingOrders.rows,
            manufacturing_orders: manufacturingOrders.rows,
            ocr_documents: ocrDocuments.rows,
            operation_events: events
        });
    } catch (error) {
        logger.error('Error tracing document:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: 'q is required' });
        const pattern = `%${q}%`;
        const result = await pool.query(`
            SELECT 'lot' AS result_type, lot_number AS result_key, product_id, NULL::text AS label
            FROM lot_inventory
            WHERE lot_number ILIKE $1
            UNION ALL
            SELECT 'qr', qr_code, product_id, lot_number
            FROM qr_units
            WHERE qr_code ILIKE $1 OR lot_number ILIKE $1
            UNION ALL
            SELECT 'sales_order', sales_order_no, NULL::int, customer_name
            FROM sales_orders
            WHERE sales_order_no ILIKE $1 OR customer_name ILIKE $1
            UNION ALL
            SELECT 'shipping_instruction', instruction_id, product_id, customer_name
            FROM shipping_instructions
            WHERE instruction_id ILIKE $1 OR customer_name ILIKE $1
            UNION ALL
            SELECT 'purchase_order', purchase_order_no, NULL::int, NULL::text
            FROM purchase_orders
            WHERE purchase_order_no ILIKE $1
            UNION ALL
            SELECT 'manufacturing_order', work_order_no, product_id, status
            FROM manufacturing_orders
            WHERE work_order_no ILIKE $1 OR finished_lot_number ILIKE $1
            ORDER BY result_type, result_key
            LIMIT 100
        `, [pattern]);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error searching traceability:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
