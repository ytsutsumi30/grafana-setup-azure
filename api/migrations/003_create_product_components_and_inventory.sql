-- 製品構成部品テーブル（QR検品用）
CREATE TABLE IF NOT EXISTS product_components (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    component_type VARCHAR(50) NOT NULL, -- 'main', 'accessory', 'documentation', 'packaging'
    component_name VARCHAR(255) NOT NULL,
    qr_code VARCHAR(255),
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_product_components_product_id ON product_components(product_id);
CREATE INDEX IF NOT EXISTS idx_product_components_qr_code ON product_components(qr_code);

-- サンプルデータ投入（既存の製品IDを使用）
DO $$
DECLARE
    sample_product_id INTEGER;
BEGIN
    -- 最初の製品を取得
    SELECT id INTO sample_product_id FROM products LIMIT 1;
    
    IF sample_product_id IS NOT NULL THEN
        -- 既存データがなければ製品構成部品のサンプルデータを追加
        IF NOT EXISTS (SELECT 1 FROM product_components WHERE product_id = sample_product_id) THEN
            INSERT INTO product_components (product_id, component_type, component_name, qr_code, is_required)
            VALUES 
                (sample_product_id, 'main', '本体', 'QR-MAIN-001', true),
                (sample_product_id, 'accessory', 'ACアダプター', 'QR-ACC-001', true),
                (sample_product_id, 'accessory', 'USBケーブル', 'QR-ACC-002', true),
                (sample_product_id, 'documentation', '取扱説明書', 'QR-DOC-001', true),
                (sample_product_id, 'packaging', '化粧箱', 'QR-PKG-001', false);
        END IF;
    END IF;
END $$;

COMMENT ON TABLE product_components IS '製品構成部品マスタ（QR検品用）';
