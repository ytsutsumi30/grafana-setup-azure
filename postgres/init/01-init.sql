-- 生産管理データベースの初期化スクリプト

-- 製品マスタテーブル
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(50) UNIQUE NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    description TEXT,
    unit_price DECIMAL(10,2),
    category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 生産計画テーブル
CREATE TABLE production_plans (
    id SERIAL PRIMARY KEY,
    plan_id VARCHAR(50) UNIQUE NOT NULL,
    product_id INTEGER REFERENCES products(id),
    planned_quantity INTEGER NOT NULL,
    planned_start_date DATE,
    planned_end_date DATE,
    status VARCHAR(20) DEFAULT 'planned', -- planned, in_progress, completed, cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 生産実績テーブル
CREATE TABLE production_records (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER REFERENCES production_plans(id),
    product_id INTEGER REFERENCES products(id),
    produced_quantity INTEGER NOT NULL,
    production_date DATE,
    worker_name VARCHAR(100),
    shift VARCHAR(20),
    quality_grade VARCHAR(10) DEFAULT 'A', -- A, B, C, NG
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 検品テーブル
CREATE TABLE inspections (
    id SERIAL PRIMARY KEY,
    production_record_id INTEGER REFERENCES production_records(id),
    inspector_name VARCHAR(100) NOT NULL,
    inspection_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    inspection_type VARCHAR(50), -- incoming, in_process, final
    passed_quantity INTEGER NOT NULL,
    failed_quantity INTEGER DEFAULT 0,
    defect_details TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- pending, passed, failed, rework
    notes TEXT
);

-- 出荷場所マスタテーブル
CREATE TABLE shipping_locations (
    id SERIAL PRIMARY KEY,
    location_code VARCHAR(20) UNIQUE NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    address VARCHAR(500),
    phone VARCHAR(20),
    contact_person VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 納入場所マスタテーブル
CREATE TABLE delivery_locations (
    id SERIAL PRIMARY KEY,
    location_code VARCHAR(20) UNIQUE NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    address VARCHAR(500),
    phone VARCHAR(20),
    contact_person VARCHAR(100),
    delivery_method VARCHAR(50) DEFAULT '宅配便', -- 宅配便、チャーター便、直送など
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 出荷指示テーブル
CREATE TABLE shipping_instructions (
    id SERIAL PRIMARY KEY,
    instruction_id VARCHAR(50) UNIQUE NOT NULL,
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    shipping_date DATE,
    shipping_location_id INTEGER REFERENCES shipping_locations(id),
    delivery_location_id INTEGER REFERENCES delivery_locations(id),
    customer_name VARCHAR(255),
    priority VARCHAR(20) DEFAULT 'normal', -- high, normal, low
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, shipped, delivered
    tracking_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 出荷検品テーブル
CREATE TABLE shipping_inspections (
    id SERIAL PRIMARY KEY,
    shipping_instruction_id INTEGER REFERENCES shipping_instructions(id),
    inspector_name VARCHAR(100) NOT NULL,
    inspection_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    inspected_quantity INTEGER NOT NULL,
    passed_quantity INTEGER NOT NULL,
    failed_quantity INTEGER DEFAULT 0,
    defect_details TEXT,
    packaging_condition VARCHAR(50),
    label_check BOOLEAN DEFAULT false,
    documentation_check BOOLEAN DEFAULT false,
    final_approval BOOLEAN DEFAULT false,
    notes TEXT
);

-- 在庫テーブル
CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id),
    current_stock INTEGER NOT NULL DEFAULT 0,
    reserved_stock INTEGER NOT NULL DEFAULT 0,
    available_stock INTEGER GENERATED ALWAYS AS (current_stock - reserved_stock) STORED,
    location VARCHAR(100),
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス作成
CREATE INDEX idx_products_code ON products(product_code);
CREATE INDEX idx_production_plans_status ON production_plans(status);
CREATE INDEX idx_production_records_date ON production_records(production_date);
CREATE INDEX idx_inspections_status ON inspections(status);
CREATE INDEX idx_shipping_instructions_status ON shipping_instructions(status);
CREATE INDEX idx_shipping_inspections_date ON shipping_inspections(inspection_date);

-- サンプルデータの挿入
INSERT INTO products (product_code, product_name, description, unit_price, category) VALUES
('PROD001', '製品A', '標準製品A', 1000.00, 'Category1'),
('PROD002', '製品B', '標準製品B', 1500.00, 'Category1'),
('PROD003', '製品C', '特殊製品C', 2000.00, 'Category2'),
('PROD004', '製品D', '標準製品D', 800.00, 'Category1'),
('PROD005', '製品E', '高級製品E', 3000.00, 'Category3');

INSERT INTO production_plans (plan_id, product_id, planned_quantity, planned_start_date, planned_end_date, status) VALUES
('PLAN001', 1, 100, CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', 'in_progress'),
('PLAN002', 2, 50, CURRENT_DATE + INTERVAL '1 day', CURRENT_DATE + INTERVAL '5 days', 'planned'),
('PLAN003', 3, 25, CURRENT_DATE + INTERVAL '2 days', CURRENT_DATE + INTERVAL '10 days', 'planned');

INSERT INTO production_records (plan_id, product_id, produced_quantity, production_date, worker_name, shift, quality_grade) VALUES
(1, 1, 30, CURRENT_DATE, '田中太郎', '昼勤', 'A'),
(1, 1, 25, CURRENT_DATE, '佐藤花子', '夜勤', 'A'),
(1, 1, 20, CURRENT_DATE - INTERVAL '1 day', '山田次郎', '昼勤', 'B');

INSERT INTO shipping_locations (location_code, location_name, address, phone, contact_person) VALUES
('TOKYO_MAIN', '東京本社倉庫', '東京都港区芝浦1-1-1', '03-1111-2222', '田中太郎'),
('OSAKA_MAIN', '大阪支社倉庫', '大阪府大阪市住之江区南港北1-1-1', '06-1111-2222', '佐藤花子'),
('NAGOYA_MAIN', '名古屋支店倉庫', '愛知県名古屋市港区港町1-1-1', '052-111-2222', '鈴木次郎');

INSERT INTO delivery_locations (location_code, location_name, address, phone, contact_person, delivery_method) VALUES
('TOKYO_BRANCH', '東京営業所', '東京都千代田区丸の内1-1-1', '03-1234-5678', '田中様', '宅配便'),
('OSAKA_BRANCH', '大阪営業所', '大阪府大阪市北区梅田1-1-1', '06-1234-5678', '佐藤様', 'チャーター便'),
('NAGOYA_BRANCH', '名古屋営業所', '愛知県名古屋市中村区名駅1-1-1', '052-123-4567', '鈴木様', '宅配便'),
('YOKOHAMA_BRANCH', '横浜営業所', '神奈川県横浜市中区本町1-1-1', '045-123-4567', '山田様', '直送'),
('KYOTO_BRANCH', '京都営業所', '京都府京都市下京区四条通1-1-1', '075-123-4567', '田中様', 'チャーター便');

INSERT INTO shipping_instructions (instruction_id, product_id, quantity, shipping_date, shipping_location_id, delivery_location_id, customer_name, priority, status, notes) VALUES
('SHIP001', 1, 50, '2024-08-27', 1, 1, 'ABC商事', 'high', 'pending', '緊急出荷'),
('SHIP002', 2, 30, '2024-08-28', 2, 2, 'XYZ株式会社', 'normal', 'pending', '通常出荷'),
('SHIP003', 3, 10, '2024-08-29', 3, 3, 'DEF工業', 'normal', 'pending', ''),
('SHIP004', 1, 25, '2024-08-28', 1, 4, 'GHI商事', 'normal', 'processing', ''),
('SHIP005', 4, 100, '2024-08-30', 1, 1, 'JKL株式会社', 'low', 'pending', ''),
('SHIP006', 2, 40, '2024-08-27', 2, 5, 'MNO工業', 'high', 'pending', '至急対応');

INSERT INTO inventory (product_id, current_stock, reserved_stock, location) VALUES
(1, 75, 50, 'A-1-01'),
(2, 120, 30, 'A-1-02'),
(3, 45, 10, 'B-2-01'),
(4, 200, 0, 'A-1-03'),
(5, 30, 0, 'C-3-01');

-- ビュー作成（レポート用）
CREATE VIEW shipping_instruction_summary AS
SELECT 
    si.instruction_id,
    p.product_code,
    p.product_name,
    si.quantity as ordered_quantity,
    si.customer_name,
    si.shipping_date,
    si.status as shipping_status,
    sl.location_name as shipping_location_name,
    sl.address as shipping_address,
    dl.location_name as delivery_location_name,
    dl.address as delivery_address,
    dl.location_code as delivery_location_code,
    shi.inspector_name,
    shi.inspection_date,
    shi.inspected_quantity,
    shi.passed_quantity,
    shi.failed_quantity,
    shi.final_approval,
    si.notes
FROM shipping_instructions si
LEFT JOIN products p ON si.product_id = p.id
LEFT JOIN shipping_locations sl ON si.shipping_location_id = sl.id
LEFT JOIN delivery_locations dl ON si.delivery_location_id = dl.id
LEFT JOIN shipping_inspections shi ON si.id = shi.shipping_instruction_id
ORDER BY si.created_at DESC;

-- 権限設定
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO production_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO production_user;
