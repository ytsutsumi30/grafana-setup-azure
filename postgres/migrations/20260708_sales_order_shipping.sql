-- Phase 3: 受注・出荷指示生成
-- 受注を登録し、既存の shipping_instructions / shipping_instruction_lines へ展開する。

CREATE TABLE IF NOT EXISTS sales_orders (
    id SERIAL PRIMARY KEY,
    sales_order_no VARCHAR(50) UNIQUE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    requested_ship_date DATE,
    shipping_location_id INTEGER REFERENCES shipping_locations(id),
    delivery_location_id INTEGER REFERENCES delivery_locations(id),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
    id SERIAL PRIMARY KEY,
    sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    ordered_quantity INTEGER NOT NULL,
    shipped_quantity INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE shipping_instructions
    ADD COLUMN IF NOT EXISTS sales_order_id INTEGER REFERENCES sales_orders(id) ON DELETE SET NULL;

ALTER TABLE shipping_instruction_lines
    ADD COLUMN IF NOT EXISTS sales_order_line_id INTEGER REFERENCES sales_order_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_requested_ship ON sales_orders(requested_ship_date);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_order ON sales_order_lines(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_instructions_sales_order ON shipping_instructions(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_instruction_lines_sales_line ON shipping_instruction_lines(sales_order_line_id);

INSERT INTO sales_orders
    (sales_order_no, customer_name, requested_ship_date, shipping_location_id, delivery_location_id, priority, status, notes)
SELECT 'SO-REVIEW-001', 'POC 顧客', CURRENT_DATE + INTERVAL '2 days',
       (SELECT id FROM shipping_locations ORDER BY id LIMIT 1),
       (SELECT id FROM delivery_locations ORDER BY id LIMIT 1),
       'normal', 'confirmed', 'Phase 3 受注サンプル'
WHERE EXISTS (SELECT 1 FROM shipping_locations)
  AND EXISTS (SELECT 1 FROM delivery_locations)
  AND NOT EXISTS (SELECT 1 FROM sales_orders WHERE sales_order_no = 'SO-REVIEW-001');

INSERT INTO sales_order_lines (sales_order_id, product_id, ordered_quantity, notes)
SELECT so.id, p.id, 2, 'Phase 3 受注明細サンプル'
FROM sales_orders so
CROSS JOIN LATERAL (SELECT id FROM products ORDER BY id LIMIT 1) p
WHERE so.sales_order_no = 'SO-REVIEW-001'
  AND NOT EXISTS (
    SELECT 1 FROM sales_order_lines sol
    WHERE sol.sales_order_id = so.id AND sol.product_id = p.id
  );

GRANT ALL PRIVILEGES ON sales_orders TO production_user;
GRANT ALL PRIVILEGES ON sales_order_lines TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE sales_orders_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE sales_order_lines_id_seq TO production_user;
