-- Phase 4: 棚卸
-- 理論在庫スナップショット、QR/ロット実数、差異承認後の在庫調整を扱う。

CREATE TABLE IF NOT EXISTS inventory_count_sessions (
    id SERIAL PRIMARY KEY,
    count_no VARCHAR(50) UNIQUE NOT NULL,
    count_name VARCHAR(255) NOT NULL,
    location_code VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    approved_at TIMESTAMP,
    approved_by VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_count_lines (
    id SERIAL PRIMARY KEY,
    inventory_count_session_id INTEGER NOT NULL REFERENCES inventory_count_sessions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    qr_code VARCHAR(255),
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    expected_quantity INTEGER NOT NULL DEFAULT 0,
    counted_quantity INTEGER,
    variance_quantity INTEGER,
    count_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    reason_code VARCHAR(80),
    comment TEXT,
    counted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id SERIAL PRIMARY KEY,
    inventory_count_session_id INTEGER REFERENCES inventory_count_sessions(id) ON DELETE SET NULL,
    inventory_count_line_id INTEGER REFERENCES inventory_count_lines(id) ON DELETE SET NULL,
    inventory_transaction_id INTEGER REFERENCES inventory_transactions(id) ON DELETE SET NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    qr_code VARCHAR(255),
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    expected_quantity INTEGER NOT NULL,
    counted_quantity INTEGER NOT NULL,
    adjustment_quantity INTEGER NOT NULL,
    reason_code VARCHAR(80),
    comment TEXT,
    approved_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_count_sessions_status ON inventory_count_sessions(status);
CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_session ON inventory_count_lines(inventory_count_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_qr ON inventory_count_lines(qr_code);
CREATE INDEX IF NOT EXISTS idx_inventory_count_lines_lot ON inventory_count_lines(lot_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_count_lines_key
ON inventory_count_lines (
    inventory_count_session_id,
    product_id,
    COALESCE(lot_number, ''),
    COALESCE(qr_unit_id, 0),
    COALESCE(location_code, '')
);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_session ON inventory_adjustments(inventory_count_session_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_transaction ON inventory_adjustments(inventory_transaction_id);

INSERT INTO inventory_count_sessions (count_no, count_name, location_code, status, notes)
VALUES ('COUNT-REVIEW-001', 'POC 棚卸サンプル', NULL, 'draft', 'Phase 4 棚卸サンプル')
ON CONFLICT (count_no) DO NOTHING;

GRANT ALL PRIVILEGES ON inventory_count_sessions TO production_user;
GRANT ALL PRIVILEGES ON inventory_count_lines TO production_user;
GRANT ALL PRIVILEGES ON inventory_adjustments TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE inventory_count_sessions_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE inventory_count_lines_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE inventory_adjustments_id_seq TO production_user;
