-- 現場レビュー用デモデータ
-- 目的: 複数品目、複数ロット、QR 個体 ID、NG 確認用ロットをローカルで確認できる状態にする。
-- 注意: POC レビュー用。実行前に対象 DB を確認すること。

BEGIN;

WITH refs AS (
    SELECT
        (SELECT id FROM products WHERE product_code = 'PROD001') AS prod001_id,
        (SELECT id FROM products WHERE product_code = 'PROD002') AS prod002_id,
        (SELECT id FROM shipping_locations ORDER BY id LIMIT 1) AS shipping_location_id,
        (SELECT id FROM delivery_locations ORDER BY id LIMIT 1) AS delivery_location_id
),
upsert_instruction AS (
    INSERT INTO shipping_instructions (
        instruction_id,
        product_id,
        quantity,
        shipping_date,
        shipping_location_id,
        delivery_location_id,
        customer_name,
        priority,
        status,
        notes
    )
    SELECT
        'REVIEW-MULTI-001',
        prod001_id,
        25,
        CURRENT_DATE + INTERVAL '1 day',
        shipping_location_id,
        delivery_location_id,
        '現場レビュー用顧客',
        'high',
        'pending',
        '現場レビュー用: 複数品目・複数ロット・QR検品確認'
    FROM refs
    ON CONFLICT (instruction_id) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        quantity = EXCLUDED.quantity,
        shipping_date = EXCLUDED.shipping_date,
        shipping_location_id = EXCLUDED.shipping_location_id,
        delivery_location_id = EXCLUDED.delivery_location_id,
        customer_name = EXCLUDED.customer_name,
        priority = EXCLUDED.priority,
        status = CASE
            WHEN shipping_instructions.status IN ('shipped', 'delivered') THEN shipping_instructions.status
            ELSE EXCLUDED.status
        END,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id
),
target_instruction AS (
    SELECT id FROM upsert_instruction
    UNION ALL
    SELECT id FROM shipping_instructions
    WHERE instruction_id = 'REVIEW-MULTI-001'
    LIMIT 1
),
line_prod001 AS (
    INSERT INTO shipping_instruction_lines (shipping_instruction_id, product_id, quantity, shipped_quantity, status)
    SELECT ti.id, refs.prod001_id, 15, 0, 'pending'
    FROM target_instruction ti, refs
    ON CONFLICT (shipping_instruction_id, product_id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id, shipping_instruction_id, product_id
),
line_prod002 AS (
    INSERT INTO shipping_instruction_lines (shipping_instruction_id, product_id, quantity, shipped_quantity, status)
    SELECT ti.id, refs.prod002_id, 10, 0, 'pending'
    FROM target_instruction ti, refs
    ON CONFLICT (shipping_instruction_id, product_id) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id, shipping_instruction_id, product_id
),
ensure_lots AS (
    INSERT INTO lot_inventory (product_id, lot_number, quantity, manufacturing_date, expiry_date, location, status, notes)
    SELECT prod001_id, 'REVIEW-P1-L1', 80, CURRENT_DATE - INTERVAL '30 days', NULL::date, 'R-1-01', 'available', '現場レビュー用 PROD001 ロット1' FROM refs
    UNION ALL
    SELECT prod001_id, 'REVIEW-P1-L2', 80, CURRENT_DATE - INTERVAL '20 days', NULL::date, 'R-1-02', 'available', '現場レビュー用 PROD001 ロット2' FROM refs
    UNION ALL
    SELECT prod002_id, 'REVIEW-P2-L1', 80, CURRENT_DATE - INTERVAL '10 days', NULL::date, 'R-2-01', 'available', '現場レビュー用 PROD002 ロット1' FROM refs
    UNION ALL
    SELECT prod002_id, 'REVIEW-P2-NG', 80, CURRENT_DATE - INTERVAL '5 days', NULL::date, 'R-2-99', 'available', '現場レビュー用 別品目NG確認ロット' FROM refs
    ON CONFLICT (product_id, lot_number) DO UPDATE SET
        quantity = GREATEST(lot_inventory.quantity, EXCLUDED.quantity),
        location = EXCLUDED.location,
        status = 'available',
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id, product_id, lot_number
),
all_lines AS (
    SELECT * FROM line_prod001
    UNION ALL
    SELECT * FROM line_prod002
),
desired_allocations AS (
    SELECT l.id AS line_id, li.id AS lot_inventory_id, li.lot_number, l.product_id, 8 AS shipped_quantity, 'review-seed' AS operator_name
    FROM all_lines l
    JOIN lot_inventory li ON li.product_id = l.product_id AND li.lot_number = 'REVIEW-P1-L1'
    WHERE li.lot_number = 'REVIEW-P1-L1'
    UNION ALL
    SELECT l.id, li.id, li.lot_number, l.product_id, 7, 'review-seed'
    FROM all_lines l
    JOIN lot_inventory li ON li.product_id = l.product_id AND li.lot_number = 'REVIEW-P1-L2'
    WHERE li.lot_number = 'REVIEW-P1-L2'
    UNION ALL
    SELECT l.id, li.id, li.lot_number, l.product_id, 10, 'review-seed'
    FROM all_lines l
    JOIN lot_inventory li ON li.product_id = l.product_id AND li.lot_number = 'REVIEW-P2-L1'
    WHERE li.lot_number = 'REVIEW-P2-L1'
),
insert_allocations AS (
    INSERT INTO shipping_lot_allocations (
        shipping_instruction_line_id,
        lot_inventory_id,
        lot_number,
        product_id,
        shipped_quantity,
        operator_name,
        status
    )
    SELECT da.line_id, da.lot_inventory_id, da.lot_number, da.product_id, da.shipped_quantity, da.operator_name, 'shipped'
    FROM desired_allocations da
    WHERE NOT EXISTS (
        SELECT 1
        FROM shipping_lot_allocations existing
        WHERE existing.shipping_instruction_line_id = da.line_id
          AND existing.lot_number = da.lot_number
          AND existing.status = 'shipped'
    )
    RETURNING shipping_instruction_line_id
)
SELECT
    (SELECT COUNT(*) FROM insert_allocations) AS inserted_allocation_count;

WITH target_instruction AS (
    SELECT id
    FROM shipping_instructions
    WHERE instruction_id = 'REVIEW-MULTI-001'
),
totals AS (
    SELECT l.id AS line_id, COALESCE(SUM(a.shipped_quantity), 0)::int AS total_quantity
    FROM shipping_instruction_lines l
    LEFT JOIN shipping_lot_allocations a
      ON a.shipping_instruction_line_id = l.id
     AND a.status = 'shipped'
    WHERE l.shipping_instruction_id = (SELECT id FROM target_instruction)
    GROUP BY l.id
)
UPDATE shipping_instruction_lines l
SET shipped_quantity = totals.total_quantity,
    status = CASE
        WHEN totals.total_quantity >= l.quantity THEN 'completed'
        WHEN totals.total_quantity > 0 THEN 'partial'
        ELSE 'pending'
    END,
    updated_at = CURRENT_TIMESTAMP
FROM totals
WHERE l.id = totals.line_id;

WITH refs AS (
    SELECT (SELECT id FROM products WHERE product_code = 'PROD001') AS product_id
)
INSERT INTO qr_units (qr_code, product_id, lot_inventory_id, lot_number, quantity, unit_type, status, location)
SELECT 'QR-REVIEW-P1-L1-A', refs.product_id, li.id, 'REVIEW-P1-L1', NULL, 'unit', 'available', li.location
FROM refs
JOIN lot_inventory li ON li.product_id = refs.product_id AND li.lot_number = 'REVIEW-P1-L1'
ON CONFLICT (qr_code) DO UPDATE SET
    product_id = EXCLUDED.product_id,
    lot_inventory_id = EXCLUDED.lot_inventory_id,
    lot_number = EXCLUDED.lot_number,
    status = 'available',
    location = EXCLUDED.location,
    updated_at = CURRENT_TIMESTAMP;

WITH refs AS (
    SELECT (SELECT id FROM products WHERE product_code = 'PROD001') AS product_id
)
INSERT INTO qr_units (qr_code, product_id, lot_inventory_id, lot_number, quantity, unit_type, status, location)
SELECT 'QR-REVIEW-P1-L2-A', refs.product_id, li.id, 'REVIEW-P1-L2', NULL, 'unit', 'available', li.location
FROM refs
JOIN lot_inventory li ON li.product_id = refs.product_id AND li.lot_number = 'REVIEW-P1-L2'
ON CONFLICT (qr_code) DO UPDATE SET
    product_id = EXCLUDED.product_id,
    lot_inventory_id = EXCLUDED.lot_inventory_id,
    lot_number = EXCLUDED.lot_number,
    status = 'available',
    location = EXCLUDED.location,
    updated_at = CURRENT_TIMESTAMP;

WITH refs AS (
    SELECT (SELECT id FROM products WHERE product_code = 'PROD002') AS product_id
)
INSERT INTO qr_units (qr_code, product_id, lot_inventory_id, lot_number, quantity, unit_type, status, location)
SELECT 'QR-REVIEW-P2-L1-A', refs.product_id, li.id, 'REVIEW-P2-L1', NULL, 'unit', 'available', li.location
FROM refs
JOIN lot_inventory li ON li.product_id = refs.product_id AND li.lot_number = 'REVIEW-P2-L1'
ON CONFLICT (qr_code) DO UPDATE SET
    product_id = EXCLUDED.product_id,
    lot_inventory_id = EXCLUDED.lot_inventory_id,
    lot_number = EXCLUDED.lot_number,
    status = 'available',
    location = EXCLUDED.location,
    updated_at = CURRENT_TIMESTAMP;

WITH refs AS (
    SELECT (SELECT id FROM products WHERE product_code = 'PROD002') AS product_id
)
INSERT INTO qr_units (qr_code, product_id, lot_inventory_id, lot_number, quantity, unit_type, status, location)
SELECT 'QR-REVIEW-NG-P2', refs.product_id, li.id, 'REVIEW-P2-NG', NULL, 'unit', 'available', li.location
FROM refs
JOIN lot_inventory li ON li.product_id = refs.product_id AND li.lot_number = 'REVIEW-P2-NG'
ON CONFLICT (qr_code) DO UPDATE SET
    product_id = EXCLUDED.product_id,
    lot_inventory_id = EXCLUDED.lot_inventory_id,
    lot_number = EXCLUDED.lot_number,
    status = 'available',
    location = EXCLUDED.location,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;

SELECT 'REVIEW-MULTI-001' AS instruction_id,
       si.id AS shipping_instruction_id,
       si.status,
       COUNT(DISTINCT l.id) AS line_count,
       COUNT(DISTINCT a.id) AS allocation_count,
       COALESCE(SUM(a.shipped_quantity), 0)::int AS allocated_quantity
FROM shipping_instructions si
LEFT JOIN shipping_instruction_lines l ON l.shipping_instruction_id = si.id
LEFT JOIN shipping_lot_allocations a ON a.shipping_instruction_line_id = l.id AND a.status = 'shipped'
WHERE si.instruction_id = 'REVIEW-MULTI-001'
GROUP BY si.id, si.status;
