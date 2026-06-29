-- QR検品関連テーブル

-- 製品同梱物マスタテーブル
CREATE TABLE IF NOT EXISTS product_components (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    component_type VARCHAR(50) NOT NULL, -- 'main', 'accessory', 'manual', 'warranty'
    component_name VARCHAR(255) NOT NULL,
    qr_code VARCHAR(255) UNIQUE NOT NULL,
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- QR検品記録テーブル
CREATE TABLE IF NOT EXISTS qr_inspections (
    id SERIAL PRIMARY KEY,
    shipping_instruction_id INTEGER REFERENCES shipping_instructions(id) ON DELETE CASCADE,
    inspector_name VARCHAR(100) NOT NULL,
    product_id INTEGER REFERENCES products(id),
    total_components INTEGER NOT NULL,
    scanned_components INTEGER DEFAULT 0,
    passed_quantity INTEGER DEFAULT 0,
    current_stock_before INTEGER,
    current_stock_after INTEGER,
    status VARCHAR(50) DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    notes TEXT,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- QR検品詳細（個別同梱物スキャン記録）
CREATE TABLE IF NOT EXISTS qr_inspection_details (
    id SERIAL PRIMARY KEY,
    qr_inspection_id INTEGER REFERENCES qr_inspections(id) ON DELETE CASCADE,
    product_component_id INTEGER REFERENCES product_components(id),
    qr_code VARCHAR(255) NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'scanned', -- 'scanned', 'error', 'duplicate'
    error_message TEXT
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_product_components_product_id ON product_components(product_id);
CREATE INDEX IF NOT EXISTS idx_product_components_qr_code ON product_components(qr_code);
CREATE INDEX IF NOT EXISTS idx_qr_inspections_shipping_instruction ON qr_inspections(shipping_instruction_id);
CREATE INDEX IF NOT EXISTS idx_qr_inspection_details_qr_inspection ON qr_inspection_details(qr_inspection_id);

-- サンプルデータ挿入（製品同梱物）
INSERT INTO product_components (product_id, component_type, component_name, qr_code) VALUES
-- 製品A (PROD001) の同梱物
(1, 'main', '製品本体', 'QR-MAIN-PROD001'),
(1, 'accessory', '付属品シール', 'QR-ACC-SEAL001'),
(1, 'packaging', '梱包箱', 'QR-BOX-PROD001'),

-- 製品B (PROD002) の同梱物
(2, 'main', '製品本体', 'QR-MAIN-PROD002'),
(2, 'accessory', '製品付属品（アダプター）', 'QR-ACC-ADAPTER002'),
(2, 'manual', '製品マニュアル', 'QR-MAN-PROD002'),
(2, 'warranty', '保証書', 'QR-WAR-PROD002'),

-- 製品C (PROD003) の同梱物
(3, 'main', '製品本体', 'QR-MAIN-PROD003'),
(3, 'accessory', '製品付属品（スタンド）', 'QR-ACC-STAND003'),
(3, 'manual', '製品マニュアル', 'QR-MAN-PROD003')
ON CONFLICT (qr_code) DO NOTHING;