-- Phase 6: 製造指図・工程実績
-- 工程、製造指図、工程実績、部品消費、完成品入庫を在庫基盤へ接続する。

CREATE TABLE IF NOT EXISTS manufacturing_processes (
    id SERIAL PRIMARY KEY,
    process_code VARCHAR(50) UNIQUE NOT NULL,
    process_name VARCHAR(255) NOT NULL,
    process_order INTEGER NOT NULL DEFAULT 1,
    standard_minutes INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS manufacturing_orders (
    id SERIAL PRIMARY KEY,
    work_order_no VARCHAR(50) UNIQUE NOT NULL,
    production_plan_id INTEGER REFERENCES production_plans(id) ON DELETE SET NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    planned_quantity INTEGER NOT NULL,
    completed_quantity INTEGER NOT NULL DEFAULT 0,
    due_date DATE,
    finished_lot_number VARCHAR(80),
    status VARCHAR(30) NOT NULL DEFAULT 'released',
    notes TEXT,
    released_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS manufacturing_order_operations (
    id SERIAL PRIMARY KEY,
    manufacturing_order_id INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    process_id INTEGER NOT NULL REFERENCES manufacturing_processes(id) ON DELETE RESTRICT,
    operation_seq INTEGER NOT NULL,
    planned_quantity INTEGER NOT NULL,
    started_quantity INTEGER NOT NULL DEFAULT 0,
    completed_quantity INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    operator_name VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (manufacturing_order_id, operation_seq)
);

CREATE TABLE IF NOT EXISTS manufacturing_material_consumptions (
    id SERIAL PRIMARY KEY,
    manufacturing_order_id INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    product_component_id INTEGER REFERENCES product_components(id) ON DELETE SET NULL,
    component_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(80),
    qr_code VARCHAR(255),
    consumed_quantity INTEGER NOT NULL,
    inventory_transaction_id INTEGER REFERENCES inventory_transactions(id) ON DELETE SET NULL,
    consumed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    operator_name VARCHAR(255),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS manufacturing_receipts (
    id SERIAL PRIMARY KEY,
    manufacturing_order_id INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(80) NOT NULL,
    qr_code VARCHAR(255),
    received_quantity INTEGER NOT NULL,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    inventory_transaction_id INTEGER REFERENCES inventory_transactions(id) ON DELETE SET NULL,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    operator_name VARCHAR(255),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_status ON manufacturing_orders(status);
CREATE INDEX IF NOT EXISTS idx_manufacturing_orders_product ON manufacturing_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_operations_order ON manufacturing_order_operations(manufacturing_order_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_consumptions_order ON manufacturing_material_consumptions(manufacturing_order_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_consumptions_lot ON manufacturing_material_consumptions(lot_number);
CREATE INDEX IF NOT EXISTS idx_manufacturing_receipts_order ON manufacturing_receipts(manufacturing_order_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_receipts_lot ON manufacturing_receipts(lot_number);

INSERT INTO manufacturing_processes (process_code, process_name, process_order, standard_minutes)
VALUES
    ('PROC-ASSY', '組立', 1, 30),
    ('PROC-QC', '工程内検査', 2, 15),
    ('PROC-PACK', '製造梱包', 3, 10)
ON CONFLICT (process_code) DO UPDATE SET
    process_name = EXCLUDED.process_name,
    process_order = EXCLUDED.process_order,
    standard_minutes = EXCLUDED.standard_minutes,
    updated_at = CURRENT_TIMESTAMP;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'production_user') THEN
        GRANT ALL PRIVILEGES ON TABLE manufacturing_processes TO production_user;
        GRANT ALL PRIVILEGES ON TABLE manufacturing_orders TO production_user;
        GRANT ALL PRIVILEGES ON TABLE manufacturing_order_operations TO production_user;
        GRANT ALL PRIVILEGES ON TABLE manufacturing_material_consumptions TO production_user;
        GRANT ALL PRIVILEGES ON TABLE manufacturing_receipts TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_processes_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_orders_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_order_operations_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_material_consumptions_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_receipts_id_seq TO production_user;
    END IF;
END $$;
