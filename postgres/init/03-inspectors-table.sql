-- 検品者マスタテーブル
CREATE TABLE IF NOT EXISTS inspectors (
    id SERIAL PRIMARY KEY,
    inspector_code VARCHAR(20) UNIQUE NOT NULL,
    inspector_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    department VARCHAR(100),
    role VARCHAR(50) DEFAULT 'inspector', -- inspector, supervisor, admin
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_inspectors_code ON inspectors(inspector_code);
CREATE INDEX IF NOT EXISTS idx_inspectors_name ON inspectors(inspector_name);
CREATE INDEX IF NOT EXISTS idx_inspectors_active ON inspectors(is_active);

-- サンプルデータ挿入
INSERT INTO inspectors (inspector_code, inspector_name, email, phone, department, role, is_active) VALUES
('INS001', '田中太郎', 'tanaka@example.com', '090-1111-2222', '品質管理部', 'supervisor', true),
('INS002', '佐藤花子', 'sato@example.com', '090-3333-4444', '品質管理部', 'inspector', true),
('INS003', '山田次郎', 'yamada@example.com', '090-5555-6666', '品質管理部', 'inspector', true),
('INS004', '鈴木一郎', 'suzuki@example.com', '090-7777-8888', '製造部', 'inspector', true),
('INS005', '高橋美咲', 'takahashi@example.com', '090-9999-0000', '品質管理部', 'inspector', true)
ON CONFLICT (inspector_code) DO NOTHING;

-- 権限設定
GRANT ALL PRIVILEGES ON inspectors TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE inspectors_id_seq TO production_user;
