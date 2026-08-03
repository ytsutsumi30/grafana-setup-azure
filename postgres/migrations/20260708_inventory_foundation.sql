-- Phase 1: 在庫・ロット・QR 共通基盤
-- 既存 lot_inventory / qr_units / 出荷検品フローを壊さず、追記型在庫履歴と集計在庫を追加する。

CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    location_code VARCHAR(50) UNIQUE NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    area_name VARCHAR(100),
    location_type VARCHAR(50) DEFAULT 'warehouse',
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE lot_inventory ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE lot_inventory ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(30) DEFAULT 'available';
ALTER TABLE qr_units ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE qr_units ADD COLUMN IF NOT EXISTS current_quantity INTEGER;

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id SERIAL PRIMARY KEY,
    transaction_type VARCHAR(50) NOT NULL,
    transaction_status VARCHAR(30) NOT NULL DEFAULT 'posted',
    inventory_status VARCHAR(30) NOT NULL DEFAULT 'available',
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    quantity_delta INTEGER NOT NULL,
    quantity_after INTEGER,
    source_type VARCHAR(80),
    source_id INTEGER,
    source_line_id INTEGER,
    reason_code VARCHAR(80),
    comment TEXT,
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_balances (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    inventory_status VARCHAR(30) NOT NULL DEFAULT 'available',
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    last_transaction_id INTEGER REFERENCES inventory_transactions(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE qr_units ADD COLUMN IF NOT EXISTS last_transaction_id INTEGER REFERENCES inventory_transactions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_balances_key
ON inventory_balances (
    product_id,
    COALESCE(lot_number, ''),
    COALESCE(qr_unit_id, 0),
    COALESCE(location_code, ''),
    inventory_status
);

CREATE TABLE IF NOT EXISTS operation_events (
    id SERIAL PRIMARY KEY,
    event_domain VARCHAR(50) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    event_status VARCHAR(30) NOT NULL DEFAULT 'success',
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    qr_code VARCHAR(255),
    quantity INTEGER,
    source_type VARCHAR(80),
    source_id INTEGER,
    source_line_id INTEGER,
    before_data JSONB,
    after_data JSONB,
    reason_code VARCHAR(80),
    comment TEXT,
    user_id VARCHAR(255),
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_locations_code ON locations(location_code);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_product ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_lot ON inventory_transactions(lot_number);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_source ON inventory_transactions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_occurred ON inventory_transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_product ON inventory_balances(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_lot ON inventory_balances(lot_number);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_location ON inventory_balances(location_code);
CREATE INDEX IF NOT EXISTS idx_operation_events_domain_type ON operation_events(event_domain, event_type);
CREATE INDEX IF NOT EXISTS idx_operation_events_source ON operation_events(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_operation_events_occurred ON operation_events(occurred_at);

INSERT INTO locations (location_code, location_name, location_type)
SELECT DISTINCT TRIM(location), TRIM(location), 'warehouse'
FROM lot_inventory
WHERE location IS NOT NULL AND TRIM(location) <> ''
ON CONFLICT (location_code) DO NOTHING;

UPDATE lot_inventory li
SET location_id = loc.id,
    inventory_status = COALESCE(li.inventory_status, li.status, 'available')
FROM locations loc
WHERE loc.location_code = li.location
  AND li.location_id IS NULL;

UPDATE qr_units qu
SET location_id = loc.id,
    current_quantity = COALESCE(qu.current_quantity, qu.quantity)
FROM locations loc
WHERE loc.location_code = qu.location
  AND qu.location_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'production_user') THEN
        GRANT ALL PRIVILEGES ON TABLE locations TO production_user;
        GRANT ALL PRIVILEGES ON TABLE inventory_transactions TO production_user;
        GRANT ALL PRIVILEGES ON TABLE inventory_balances TO production_user;
        GRANT ALL PRIVILEGES ON TABLE operation_events TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE locations_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE inventory_transactions_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE inventory_balances_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE operation_events_id_seq TO production_user;
    END IF;
END $$;
