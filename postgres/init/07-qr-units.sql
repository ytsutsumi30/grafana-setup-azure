-- QR 個体 ID 管理テーブル
-- ロット番号スキャン互換を維持しつつ、箱・パレット・個品などの QR 管理単位を扱う。

CREATE TABLE IF NOT EXISTS qr_units (
    id SERIAL PRIMARY KEY,
    qr_code VARCHAR(255) UNIQUE NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    lot_number VARCHAR(50) NOT NULL,
    quantity INTEGER,
    unit_type VARCHAR(50) DEFAULT 'unit',
    status VARCHAR(20) DEFAULT 'available',
    location VARCHAR(100),
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_scanned_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE picking_records ADD COLUMN IF NOT EXISTS qr_code VARCHAR(255);
ALTER TABLE picking_records ADD COLUMN IF NOT EXISTS scan_source VARCHAR(50) DEFAULT 'lot_number_compat';

CREATE INDEX IF NOT EXISTS idx_qr_units_qr_code ON qr_units(qr_code);
CREATE INDEX IF NOT EXISTS idx_qr_units_product_lot ON qr_units(product_id, lot_number);
CREATE INDEX IF NOT EXISTS idx_qr_units_status ON qr_units(status);
CREATE INDEX IF NOT EXISTS idx_picking_records_qr_code ON picking_records(qr_code);
CREATE INDEX IF NOT EXISTS idx_picking_records_scan_source ON picking_records(scan_source);

COMMENT ON TABLE qr_units IS 'QR 個体 ID 管理単位。ロット番号とは別に、箱・パレット・個品など現物 QR を管理する。';
COMMENT ON COLUMN picking_records.qr_code IS 'スキャン入力が QR 個体 ID の場合の QR コード。ロット番号互換スキャンでは入力値を保持する場合がある。';
COMMENT ON COLUMN picking_records.scan_source IS 'qr_unit: qr_units 解決、lot_number_compat: 既存ロット番号互換。';

GRANT ALL PRIVILEGES ON TABLE qr_units TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE qr_units_id_seq TO production_user;
