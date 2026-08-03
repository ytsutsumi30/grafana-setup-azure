-- Phase 2: 発注・入庫 MVP

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    supplier_code VARCHAR(50) UNIQUE NOT NULL,
    supplier_name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    contact_person VARCHAR(100),
    email VARCHAR(255),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    purchase_order_no VARCHAR(50) UNIQUE NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
    order_date DATE DEFAULT CURRENT_DATE,
    expected_date DATE,
    status VARCHAR(30) DEFAULT 'draft',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id SERIAL PRIMARY KEY,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    ordered_quantity INTEGER NOT NULL,
    received_quantity INTEGER NOT NULL DEFAULT 0,
    unit_price DECIMAL(12,2),
    expected_date DATE,
    status VARCHAR(30) DEFAULT 'ordered',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receiving_orders (
    id SERIAL PRIMARY KEY,
    receiving_order_no VARCHAR(50) UNIQUE NOT NULL,
    purchase_order_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
    expected_date DATE,
    status VARCHAR(30) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receiving_order_lines (
    id SERIAL PRIMARY KEY,
    receiving_order_id INTEGER NOT NULL REFERENCES receiving_orders(id) ON DELETE CASCADE,
    purchase_order_line_id INTEGER REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    expected_quantity INTEGER NOT NULL,
    received_quantity INTEGER NOT NULL DEFAULT 0,
    accepted_quantity INTEGER NOT NULL DEFAULT 0,
    rejected_quantity INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receiving_results (
    id SERIAL PRIMARY KEY,
    receiving_order_id INTEGER NOT NULL REFERENCES receiving_orders(id) ON DELETE CASCADE,
    receiving_order_line_id INTEGER REFERENCES receiving_order_lines(id) ON DELETE SET NULL,
    purchase_order_line_id INTEGER REFERENCES purchase_order_lines(id) ON DELETE SET NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50) NOT NULL,
    qr_code VARCHAR(255),
    received_quantity INTEGER NOT NULL,
    accepted_quantity INTEGER NOT NULL DEFAULT 0,
    rejected_quantity INTEGER NOT NULL DEFAULT 0,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    inspection_status VARCHAR(30) DEFAULT 'accepted',
    reason_code VARCHAR(80),
    comment TEXT,
    idempotency_key VARCHAR(120),
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_po ON purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receiving_orders_po ON receiving_orders(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receiving_orders_status ON receiving_orders(status);
CREATE INDEX IF NOT EXISTS idx_receiving_order_lines_order ON receiving_order_lines(receiving_order_id);
CREATE INDEX IF NOT EXISTS idx_receiving_results_order ON receiving_results(receiving_order_id);
CREATE INDEX IF NOT EXISTS idx_receiving_results_qr ON receiving_results(qr_code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_receiving_results_idempotency
ON receiving_results (receiving_order_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

INSERT INTO suppliers (supplier_code, supplier_name, contact_person, notes)
VALUES ('SUP-REVIEW-001', '現場レビュー用仕入先', 'review', '発注・入庫 MVP 確認用')
ON CONFLICT (supplier_code) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'production_user') THEN
        GRANT ALL PRIVILEGES ON TABLE suppliers TO production_user;
        GRANT ALL PRIVILEGES ON TABLE purchase_orders TO production_user;
        GRANT ALL PRIVILEGES ON TABLE purchase_order_lines TO production_user;
        GRANT ALL PRIVILEGES ON TABLE receiving_orders TO production_user;
        GRANT ALL PRIVILEGES ON TABLE receiving_order_lines TO production_user;
        GRANT ALL PRIVILEGES ON TABLE receiving_results TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE suppliers_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE purchase_orders_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE purchase_order_lines_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE receiving_orders_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE receiving_order_lines_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE receiving_results_id_seq TO production_user;
    END IF;
END $$;
