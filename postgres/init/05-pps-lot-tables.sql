-- PPS（PICK-PACK-SHIP）フロー & ロット管理テーブル

-- ロット別在庫テーブル
CREATE TABLE IF NOT EXISTS lot_inventory (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
    lot_number VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    manufacturing_date DATE,
    expiry_date DATE,
    location VARCHAR(100),
    status VARCHAR(20) DEFAULT 'available', -- available, reserved, picked, shipped
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, lot_number)
);

-- ピッキング指示テーブル
CREATE TABLE IF NOT EXISTS picking_instructions (
    id SERIAL PRIMARY KEY,
    picking_id VARCHAR(50) UNIQUE NOT NULL,        -- e.g. PICK-SHIP001-001
    shipping_instruction_id INTEGER REFERENCES shipping_instructions(id) ON DELETE RESTRICT,
    picker_name VARCHAR(100),
    total_quantity INTEGER NOT NULL,                -- 指示数量
    picked_quantity INTEGER DEFAULT 0,             -- ピッキング済み数量
    status VARCHAR(20) DEFAULT 'pending',          -- pending, in_progress, completed, cancelled
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ピッキング記録テーブル（個別スキャン）
CREATE TABLE IF NOT EXISTS picking_records (
    id SERIAL PRIMARY KEY,
    picking_instruction_id INTEGER REFERENCES picking_instructions(id) ON DELETE CASCADE,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id),
    lot_number VARCHAR(50) NOT NULL,
    product_id INTEGER REFERENCES products(id),
    picked_quantity INTEGER NOT NULL DEFAULT 1,
    location VARCHAR(100),
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'picked',           -- picked, error
    error_message TEXT
);

-- 梱包記録テーブル
CREATE TABLE IF NOT EXISTS packing_records (
    id SERIAL PRIMARY KEY,
    shipping_instruction_id INTEGER REFERENCES shipping_instructions(id) ON DELETE RESTRICT,
    picking_instruction_id INTEGER REFERENCES picking_instructions(id),
    packer_name VARCHAR(100),
    packed_quantity INTEGER DEFAULT 0,
    box_count INTEGER DEFAULT 1,
    total_weight_kg DECIMAL(8,2),
    packaging_type VARCHAR(50),                    -- 例: '段ボール', 'パレット', '袋'
    lot_numbers TEXT,                              -- カンマ区切りで梱包されたロット番号群
    status VARCHAR(20) DEFAULT 'pending',          -- pending, in_progress, completed
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- qr_inspection_details にロット番号カラムを追加
ALTER TABLE qr_inspection_details ADD COLUMN IF NOT EXISTS lot_number VARCHAR(50);

-- shipping_instructions のステータスを拡張
-- pending → picking → packing → inspecting → shipped → delivered
-- （既存の 'processing' は 'inspecting' に移行）
COMMENT ON COLUMN shipping_instructions.status IS
    'pending: 未着手, picking: ピッキング中, packing: 梱包中, inspecting: 検品中, shipped: 出荷済, delivered: 配達済';

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_lot_inventory_product ON lot_inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_lot_inventory_lot_number ON lot_inventory(lot_number);
CREATE INDEX IF NOT EXISTS idx_lot_inventory_status ON lot_inventory(status);
CREATE INDEX IF NOT EXISTS idx_picking_instructions_shipping ON picking_instructions(shipping_instruction_id);
CREATE INDEX IF NOT EXISTS idx_picking_instructions_status ON picking_instructions(status);
CREATE INDEX IF NOT EXISTS idx_picking_records_picking ON picking_records(picking_instruction_id);
CREATE INDEX IF NOT EXISTS idx_picking_records_lot ON picking_records(lot_number);
CREATE INDEX IF NOT EXISTS idx_packing_records_shipping ON packing_records(shipping_instruction_id);

-- サンプルデータ：ロット別在庫
INSERT INTO lot_inventory (product_id, lot_number, quantity, manufacturing_date, expiry_date, location, status) VALUES
(1, 'LOT-2026-0001', 30, '2026-01-10', NULL, 'A-1-01', 'available'),
(1, 'LOT-2026-0002', 45, '2026-02-15', NULL, 'A-1-01', 'available'),
(2, 'LOT-2026-0003', 60, '2026-01-20', NULL, 'A-1-02', 'available'),
(2, 'LOT-2026-0004', 60, '2026-03-01', NULL, 'A-1-02', 'available'),
(3, 'LOT-2026-0005', 25, '2026-02-01', NULL, 'B-2-01', 'available'),
(4, 'LOT-2026-0006', 100, '2026-01-05', NULL, 'A-1-03', 'available'),
(4, 'LOT-2026-0007', 100, '2026-02-10', NULL, 'A-1-03', 'available')
ON CONFLICT (product_id, lot_number) DO NOTHING;

-- 権限設定
GRANT ALL PRIVILEGES ON TABLE lot_inventory TO production_user;
GRANT ALL PRIVILEGES ON TABLE picking_instructions TO production_user;
GRANT ALL PRIVILEGES ON TABLE picking_records TO production_user;
GRANT ALL PRIVILEGES ON TABLE packing_records TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE lot_inventory_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE picking_instructions_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE picking_records_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE packing_records_id_seq TO production_user;
