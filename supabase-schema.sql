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
ON CONFLICT (qr_code) DO NOTHING;-- 検品者マスタテーブル
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
-- 新QC七つ道具用テーブル定義
-- 定性データ分析ツールのためのスキーマ

-- ==============================================
-- 共通：分析プロジェクトテーブル
-- ==============================================
CREATE TABLE qc_analysis_projects (
    id SERIAL PRIMARY KEY,
    project_name VARCHAR(200) NOT NULL,
    tool_type VARCHAR(50) NOT NULL CHECK (tool_type IN (
        'affinity',      -- 親和図法
        'relation',      -- 連関図法
        'tree',          -- 系統図法
        'matrix',        -- マトリックス図法
        'matrix_data',   -- マトリックスデータ解析法
        'arrow',         -- アローダイアグラム
        'pdpc'           -- PDPC法
    )),
    description TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_template BOOLEAN DEFAULT FALSE,
    project_data JSONB DEFAULT '{}'::jsonb  -- ツール固有の設定・メタデータ
);

CREATE INDEX idx_qc_projects_tool ON qc_analysis_projects(tool_type);
CREATE INDEX idx_qc_projects_created ON qc_analysis_projects(created_at DESC);

-- ==============================================
-- 1. 親和図法（KJ法）
-- ==============================================
CREATE TABLE qc_affinity_cards (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    card_text TEXT NOT NULL,
    group_name VARCHAR(200),           -- グループ名（カテゴリ）
    position_x INTEGER DEFAULT 0,      -- X座標
    position_y INTEGER DEFAULT 0,      -- Y座標
    color VARCHAR(20) DEFAULT '#fff3cd', -- カードの色
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_affinity_cards_project ON qc_affinity_cards(project_id);

-- ==============================================
-- 2. 連関図法
-- ==============================================
CREATE TABLE qc_relation_nodes (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    node_text TEXT NOT NULL,
    node_type VARCHAR(50) DEFAULT 'factor',  -- 'cause', 'effect', 'factor'
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    color VARCHAR(20) DEFAULT '#d1ecf1',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE qc_relation_edges (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    from_node_id INTEGER REFERENCES qc_relation_nodes(id) ON DELETE CASCADE,
    to_node_id INTEGER REFERENCES qc_relation_nodes(id) ON DELETE CASCADE,
    edge_label TEXT,                   -- 関係性の説明
    strength VARCHAR(20) DEFAULT 'medium',  -- 'weak', 'medium', 'strong'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_node_id, to_node_id)
);

CREATE INDEX idx_relation_nodes_project ON qc_relation_nodes(project_id);
CREATE INDEX idx_relation_edges_project ON qc_relation_edges(project_id);

-- ==============================================
-- 3. 系統図法（ツリー図）
-- ==============================================
CREATE TABLE qc_tree_nodes (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    parent_node_id INTEGER REFERENCES qc_tree_nodes(id) ON DELETE CASCADE,
    node_text TEXT NOT NULL,
    node_level INTEGER DEFAULT 0,     -- 階層レベル（0=ルート）
    node_order INTEGER DEFAULT 0,     -- 同じ親内での順序
    node_type VARCHAR(50) DEFAULT 'objective',  -- 'objective', 'means'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tree_nodes_project ON qc_tree_nodes(project_id);
CREATE INDEX idx_tree_nodes_parent ON qc_tree_nodes(parent_node_id);

-- ==============================================
-- 4. マトリックス図法
-- ==============================================
CREATE TABLE qc_matrix_items (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    item_text TEXT NOT NULL,
    item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('row', 'column')),
    item_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE qc_matrix_cells (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    row_item_id INTEGER REFERENCES qc_matrix_items(id) ON DELETE CASCADE,
    column_item_id INTEGER REFERENCES qc_matrix_items(id) ON DELETE CASCADE,
    relationship_strength VARCHAR(20) DEFAULT 'none',  -- 'none', 'weak', 'medium', 'strong'
    relationship_value NUMERIC(10, 2),  -- 数値での関係度
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(row_item_id, column_item_id)
);

CREATE INDEX idx_matrix_items_project ON qc_matrix_items(project_id);
CREATE INDEX idx_matrix_cells_project ON qc_matrix_cells(project_id);

-- ==============================================
-- 5. マトリックスデータ解析法（主成分分析など）
-- ==============================================
CREATE TABLE qc_matrix_data_analysis (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    analysis_type VARCHAR(50) DEFAULT 'pca',  -- 'pca', 'correlation', 'cluster'
    data_matrix JSONB NOT NULL,        -- 数値データ行列
    analysis_result JSONB,             -- 解析結果（固有値、主成分など）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_matrix_data_project ON qc_matrix_data_analysis(project_id);

-- ==============================================
-- 6. アローダイアグラム（PERT図）
-- ==============================================
CREATE TABLE qc_arrow_tasks (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    task_name VARCHAR(200) NOT NULL,
    task_duration NUMERIC(10, 2) DEFAULT 0,  -- 所要時間（日数）
    earliest_start NUMERIC(10, 2),           -- 最早開始時刻
    latest_start NUMERIC(10, 2),             -- 最遅開始時刻
    slack_time NUMERIC(10, 2),               -- 余裕時間
    is_critical BOOLEAN DEFAULT FALSE,       -- クリティカルパスか
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE qc_arrow_dependencies (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    predecessor_task_id INTEGER REFERENCES qc_arrow_tasks(id) ON DELETE CASCADE,
    successor_task_id INTEGER REFERENCES qc_arrow_tasks(id) ON DELETE CASCADE,
    dependency_type VARCHAR(20) DEFAULT 'FS',  -- 'FS', 'SS', 'FF', 'SF'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(predecessor_task_id, successor_task_id)
);

CREATE INDEX idx_arrow_tasks_project ON qc_arrow_tasks(project_id);
CREATE INDEX idx_arrow_deps_project ON qc_arrow_dependencies(project_id);

-- ==============================================
-- 7. PDPC法（過程決定計画図）
-- ==============================================
CREATE TABLE qc_pdpc_nodes (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES qc_analysis_projects(id) ON DELETE CASCADE,
    parent_node_id INTEGER REFERENCES qc_pdpc_nodes(id) ON DELETE CASCADE,
    node_text TEXT NOT NULL,
    node_type VARCHAR(50) DEFAULT 'process',  -- 'objective', 'process', 'problem', 'countermeasure'
    node_level INTEGER DEFAULT 0,
    probability NUMERIC(5, 2),         -- 発生確率（%）
    impact_level VARCHAR(20),          -- 'high', 'medium', 'low'
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pdpc_nodes_project ON qc_pdpc_nodes(project_id);
CREATE INDEX idx_pdpc_nodes_parent ON qc_pdpc_nodes(parent_node_id);

-- ==============================================
-- 権限設定
-- ==============================================

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO production_user;
-- モニタリング・分析用テーブル定義
-- リアルタイム出荷モニタリング、在庫健全性、需給予測用

-- ==============================================
-- 1. メトリクス時系列データテーブル
-- ==============================================
CREATE TABLE metrics_timeseries (
    id SERIAL PRIMARY KEY,
    metric_type VARCHAR(50) NOT NULL,  -- 'shipment_count', 'defect_rate', 'inspection_time', etc.
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    value NUMERIC(10, 4) NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    inspector_name VARCHAR(100),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_metrics_type_time ON metrics_timeseries(metric_type, timestamp DESC);
CREATE INDEX idx_metrics_product ON metrics_timeseries(product_id);
CREATE INDEX idx_metrics_inspector ON metrics_timeseries(inspector_name);

-- ==============================================
-- 2. 在庫スナップショット（日次集計）
-- ==============================================
CREATE TABLE inventory_snapshots (
    id SERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    quantity_on_hand NUMERIC(10, 2) NOT NULL,
    quantity_reserved NUMERIC(10, 2) DEFAULT 0,
    quantity_available NUMERIC(10, 2) NOT NULL,
    daily_shipments NUMERIC(10, 2) DEFAULT 0,      -- 当日出荷数
    daily_receipts NUMERIC(10, 2) DEFAULT 0,       -- 当日入荷数
    turnover_rate NUMERIC(10, 4),                  -- 在庫回転率
    days_of_stock NUMERIC(10, 2),                  -- 在庫日数
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(snapshot_date, product_id)
);

CREATE INDEX idx_inventory_snap_date ON inventory_snapshots(snapshot_date DESC);
CREATE INDEX idx_inventory_snap_product ON inventory_snapshots(product_id);

-- ==============================================
-- 3. 検品パフォーマンスサマリー（時間帯別）
-- ==============================================
CREATE TABLE inspection_performance_hourly (
    id SERIAL PRIMARY KEY,
    hour_timestamp TIMESTAMP NOT NULL,             -- 時間帯の開始時刻（1時間単位）
    inspector_name VARCHAR(100),
    total_inspections INTEGER DEFAULT 0,
    completed_inspections INTEGER DEFAULT 0,
    failed_inspections INTEGER DEFAULT 0,
    avg_inspection_time NUMERIC(10, 2),            -- 平均検品時間（分）
    total_components_scanned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(hour_timestamp, inspector_name)
);

CREATE INDEX idx_perf_hourly_time ON inspection_performance_hourly(hour_timestamp DESC);
CREATE INDEX idx_perf_hourly_inspector ON inspection_performance_hourly(inspector_name);

-- ==============================================
-- 4. アラート履歴テーブル
-- ==============================================
CREATE TABLE monitoring_alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,               -- 'stockout_risk', 'quality_degradation', 'performance_drop'
    severity VARCHAR(20) DEFAULT 'medium',         -- 'low', 'medium', 'high', 'critical'
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    alert_message TEXT NOT NULL,
    alert_data JSONB DEFAULT '{}'::jsonb,          -- 追加データ
    is_acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP                           -- アラート有効期限
);

CREATE INDEX idx_alerts_type ON monitoring_alerts(alert_type);
CREATE INDEX idx_alerts_severity ON monitoring_alerts(severity);
CREATE INDEX idx_alerts_active ON monitoring_alerts(is_acknowledged, expires_at);

-- ==============================================
-- 5. 需要予測データテーブル
-- ==============================================
CREATE TABLE demand_forecast (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL,
    predicted_quantity NUMERIC(10, 2) NOT NULL,
    confidence_interval_lower NUMERIC(10, 2),
    confidence_interval_upper NUMERIC(10, 2),
    forecast_method VARCHAR(50),                   -- 'moving_average', 'exponential_smoothing', 'arima', etc.
    model_version VARCHAR(50),
    accuracy_score NUMERIC(5, 4),                  -- 予測精度（実績と比較後）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, forecast_date, forecast_method)
);

CREATE INDEX idx_forecast_product_date ON demand_forecast(product_id, forecast_date);

-- ==============================================
-- 6. ABC分析結果テーブル
-- ==============================================
CREATE TABLE abc_analysis (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    analysis_period_start DATE NOT NULL,
    analysis_period_end DATE NOT NULL,
    total_revenue NUMERIC(12, 2),
    total_quantity NUMERIC(10, 2),
    revenue_percentage NUMERIC(5, 2),              -- 全体売上に占める割合
    cumulative_percentage NUMERIC(5, 2),           -- 累積売上割合
    abc_category CHAR(1) CHECK (abc_category IN ('A', 'B', 'C')),  -- A: 0-80%, B: 80-95%, C: 95-100%
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, analysis_period_start, analysis_period_end)
);

CREATE INDEX idx_abc_category ON abc_analysis(abc_category);
CREATE INDEX idx_abc_period ON abc_analysis(analysis_period_end DESC);

-- ==============================================
-- 7. ビュー：リアルタイム在庫健全性
-- ==============================================
CREATE OR REPLACE VIEW v_inventory_health AS
WITH daily_demand AS (
    SELECT
        product_id,
        AVG(daily_shipments) as avg_daily_demand,
        STDDEV(daily_shipments) as stddev_daily_demand
    FROM inventory_snapshots
    WHERE snapshot_date > CURRENT_DATE - INTERVAL '30 days'
    GROUP BY product_id
),
last_snapshot AS (
    SELECT DISTINCT ON (product_id)
        product_id,
        quantity_available,
        turnover_rate,
        snapshot_date
    FROM inventory_snapshots
    ORDER BY product_id, snapshot_date DESC
)
SELECT
    p.id as product_id,
    p.product_name,
    p.product_code,
    COALESCE(i.current_stock, 0) as current_stock,
    COALESCE(i.reserved_stock, 0) as reserved_stock,
    COALESCE(i.available_stock, 0) as available_stock,
    COALESCE(dd.avg_daily_demand, 0) as avg_daily_demand,
    COALESCE(dd.stddev_daily_demand, 0) as demand_volatility,
    CASE
        WHEN dd.avg_daily_demand > 0 THEN ROUND(i.available_stock / dd.avg_daily_demand, 1)
        ELSE NULL
    END as days_of_stock,
    COALESCE(ls.turnover_rate, 0) as turnover_rate,
    CASE
        WHEN dd.avg_daily_demand > 0 AND i.available_stock / dd.avg_daily_demand < 7 THEN 'critical'
        WHEN dd.avg_daily_demand > 0 AND i.available_stock / dd.avg_daily_demand < 14 THEN 'warning'
        WHEN i.available_stock > dd.avg_daily_demand * 90 THEN 'overstocked'
        ELSE 'healthy'
    END as health_status
FROM products p
LEFT JOIN inventory i ON p.id = i.product_id
LEFT JOIN daily_demand dd ON p.id = dd.product_id
LEFT JOIN last_snapshot ls ON p.id = ls.product_id;

-- ==============================================
-- 8. ビュー：検品員パフォーマンスサマリー
-- ==============================================
CREATE OR REPLACE VIEW v_inspector_performance AS
WITH recent_inspections AS (
    SELECT
        inspector_name,
        COUNT(*) as total_inspections,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60) as avg_time_minutes,
        SUM(scanned_components) as total_components,
        MIN(completed_at) as first_inspection,
        MAX(completed_at) as last_inspection
    FROM qr_inspections
    WHERE completed_at > CURRENT_DATE - INTERVAL '7 days'
    GROUP BY inspector_name
)
SELECT
    inspector_name,
    total_inspections,
    completed_count,
    failed_count,
    ROUND((completed_count::NUMERIC / NULLIF(total_inspections, 0) * 100), 2) as success_rate,
    ROUND(avg_time_minutes::NUMERIC, 2) as avg_inspection_time,
    total_components,
    ROUND((total_components::NUMERIC / NULLIF(total_inspections, 0)), 1) as avg_components_per_inspection,
    first_inspection,
    last_inspection,
    CASE
        WHEN completed_count::NUMERIC / NULLIF(total_inspections, 0) >= 0.95 THEN 'excellent'
        WHEN completed_count::NUMERIC / NULLIF(total_inspections, 0) >= 0.85 THEN 'good'
        WHEN completed_count::NUMERIC / NULLIF(total_inspections, 0) >= 0.70 THEN 'fair'
        ELSE 'needs_improvement'
    END as performance_rating
FROM recent_inspections
WHERE inspector_name IS NOT NULL;

-- ==============================================
-- 権限設定
-- ==============================================

GRANT SELECT ON v_inventory_health TO production_user;
GRANT SELECT ON v_inspector_performance TO production_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO production_user;
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
-- 出荷指示の複数製品対応 + ロット別出荷数
-- 1 出荷指示 = 1〜N 製品(明細)。各明細 = 1〜N ロットから出荷数を割り当て。
-- 既存の単一製品 shipping_instructions は 1 明細として backfill する。

-- 出荷指示明細(1指示=N製品)
CREATE TABLE IF NOT EXISTS shipping_instruction_lines (
    id SERIAL PRIMARY KEY,
    shipping_instruction_id INTEGER NOT NULL REFERENCES shipping_instructions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,                 -- 指示数量
    shipped_quantity INTEGER NOT NULL DEFAULT 0, -- 出荷済み合計(ロット引当の合計)
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, partial, completed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (shipping_instruction_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_sil_instruction ON shipping_instruction_lines(shipping_instruction_id);

-- ロット別出荷数の割り当て(QRスキャンで特定したロットからの出荷数)
CREATE TABLE IF NOT EXISTS shipping_lot_allocations (
    id SERIAL PRIMARY KEY,
    shipping_instruction_line_id INTEGER NOT NULL REFERENCES shipping_instruction_lines(id) ON DELETE CASCADE,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id),
    lot_number VARCHAR(50) NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id),
    shipped_quantity INTEGER NOT NULL,         -- このロットからの出荷数
    operator_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'shipped', -- shipped, cancelled
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sla_line ON shipping_lot_allocations(shipping_instruction_line_id);

-- 既存の単一製品 shipping_instructions を 1 明細として backfill(未登録のもののみ)
INSERT INTO shipping_instruction_lines (shipping_instruction_id, product_id, quantity)
SELECT si.id, si.product_id, si.quantity
FROM shipping_instructions si
WHERE si.product_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM shipping_instruction_lines l
    WHERE l.shipping_instruction_id = si.id AND l.product_id = si.product_id
  );
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

-- 出荷検品 業務イベント監査ログ

CREATE TABLE IF NOT EXISTS shipping_audit_events (
    id SERIAL PRIMARY KEY,
    shipping_instruction_id INTEGER REFERENCES shipping_instructions(id) ON DELETE SET NULL,
    line_id INTEGER REFERENCES shipping_instruction_lines(id) ON DELETE SET NULL,
    allocation_id INTEGER REFERENCES shipping_lot_allocations(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    event_status VARCHAR(30) NOT NULL DEFAULT 'success',
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    lot_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    qr_code VARCHAR(255),
    quantity INTEGER,
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

CREATE INDEX IF NOT EXISTS idx_shipping_audit_instruction ON shipping_audit_events(shipping_instruction_id);
CREATE INDEX IF NOT EXISTS idx_shipping_audit_event_type ON shipping_audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_shipping_audit_occurred_at ON shipping_audit_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_shipping_audit_qr_code ON shipping_audit_events(qr_code);
CREATE INDEX IF NOT EXISTS idx_shipping_audit_lot_number ON shipping_audit_events(lot_number);

COMMENT ON TABLE shipping_audit_events IS '出荷検品の業務イベント監査ログ。数量確定、PPS、QR スキャン、完了後修正、帳票出力などを記録する。';

-- Phase 1: 在庫・ロット・QR 共通基盤
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
-- PROD001（製品A）のQRコードを修正するマイグレーションスクリプト
-- 実行日: 2025-11-18
-- 目的: SHIP001で使用する実際のQRコードに合わせてデータを更新

BEGIN;

-- 既存のPROD001（product_id=1）の同梱物データを削除
DELETE FROM product_components WHERE product_id = 1;

-- 正しいQRコードで再挿入
INSERT INTO product_components (product_id, component_type, component_name, qr_code, is_required) VALUES
(1, 'main', '製品本体', 'QR-MAIN-PROD001', true),
(1, 'accessory', '付属品シール', 'QR-ACC-SEAL001', true),
(1, 'packaging', '梱包箱', 'QR-BOX-PROD001', true);

-- 確認用のSELECT
SELECT
    pc.id,
    pc.product_id,
    p.product_code,
    p.product_name,
    pc.component_type,
    pc.component_name,
    pc.qr_code,
    pc.is_required
FROM product_components pc
JOIN products p ON pc.product_id = p.id
WHERE pc.product_id = 1
ORDER BY
    CASE pc.component_type
        WHEN 'main' THEN 1
        WHEN 'accessory' THEN 2
        WHEN 'packaging' THEN 3
        ELSE 4
    END;

COMMIT;

-- Phase 3: 受注・出荷指示生成
CREATE TABLE IF NOT EXISTS sales_orders (
    id SERIAL PRIMARY KEY,
    sales_order_no VARCHAR(50) UNIQUE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    requested_ship_date DATE,
    shipping_location_id INTEGER REFERENCES shipping_locations(id),
    delivery_location_id INTEGER REFERENCES delivery_locations(id),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
    id SERIAL PRIMARY KEY,
    sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    ordered_quantity INTEGER NOT NULL,
    shipped_quantity INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE shipping_instructions
    ADD COLUMN IF NOT EXISTS sales_order_id INTEGER REFERENCES sales_orders(id) ON DELETE SET NULL;

ALTER TABLE shipping_instruction_lines
    ADD COLUMN IF NOT EXISTS sales_order_line_id INTEGER REFERENCES sales_order_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_sales_orders_requested_ship ON sales_orders(requested_ship_date);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_order ON sales_order_lines(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_instructions_sales_order ON shipping_instructions(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_instruction_lines_sales_line ON shipping_instruction_lines(sales_order_line_id);

INSERT INTO sales_orders
    (sales_order_no, customer_name, requested_ship_date, shipping_location_id, delivery_location_id, priority, status, notes)
SELECT 'SO-REVIEW-001', 'POC 顧客', CURRENT_DATE + INTERVAL '2 days',
       (SELECT id FROM shipping_locations ORDER BY id LIMIT 1),
       (SELECT id FROM delivery_locations ORDER BY id LIMIT 1),
       'normal', 'confirmed', 'Phase 3 受注サンプル'
WHERE EXISTS (SELECT 1 FROM shipping_locations)
  AND EXISTS (SELECT 1 FROM delivery_locations)
  AND NOT EXISTS (SELECT 1 FROM sales_orders WHERE sales_order_no = 'SO-REVIEW-001');

INSERT INTO sales_order_lines (sales_order_id, product_id, ordered_quantity, notes)
SELECT so.id, p.id, 2, 'Phase 3 受注明細サンプル'
FROM sales_orders so
CROSS JOIN LATERAL (SELECT id FROM products ORDER BY id LIMIT 1) p
WHERE so.sales_order_no = 'SO-REVIEW-001'
  AND NOT EXISTS (
    SELECT 1 FROM sales_order_lines sol
    WHERE sol.sales_order_id = so.id AND sol.product_id = p.id
  );

GRANT ALL PRIVILEGES ON sales_orders TO production_user;
GRANT ALL PRIVILEGES ON sales_order_lines TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE sales_orders_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE sales_order_lines_id_seq TO production_user;

-- Phase 4: 棚卸
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

-- Phase 5: OCR 取込
CREATE TABLE IF NOT EXISTS ocr_documents (
    id SERIAL PRIMARY KEY,
    document_no VARCHAR(80) UNIQUE NOT NULL,
    document_type VARCHAR(40) NOT NULL,
    source_engine VARCHAR(80) DEFAULT 'manual',
    source_file_name VARCHAR(255),
    raw_text TEXT NOT NULL,
    normalized_text TEXT,
    confidence NUMERIC(5,2),
    extraction_status VARCHAR(30) NOT NULL DEFAULT 'parsed',
    extracted_data JSONB DEFAULT '{}'::jsonb,
    linked_source_type VARCHAR(80),
    linked_source_id INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ocr_document_lines (
    id SERIAL PRIMARY KEY,
    ocr_document_id INTEGER NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    product_code VARCHAR(80),
    product_name VARCHAR(255),
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    quantity INTEGER,
    unit_price NUMERIC(12,2),
    amount NUMERIC(12,2),
    lot_number VARCHAR(80),
    raw_line TEXT,
    match_status VARCHAR(30) NOT NULL DEFAULT 'unmatched',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ocr_business_matches (
    id SERIAL PRIMARY KEY,
    ocr_document_id INTEGER NOT NULL REFERENCES ocr_documents(id) ON DELETE CASCADE,
    ocr_document_line_id INTEGER REFERENCES ocr_document_lines(id) ON DELETE CASCADE,
    match_type VARCHAR(60) NOT NULL,
    target_type VARCHAR(80),
    target_id INTEGER,
    target_line_id INTEGER,
    match_score NUMERIC(5,2) NOT NULL DEFAULT 0,
    match_status VARCHAR(30) NOT NULL DEFAULT 'candidate',
    match_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ocr_documents_type ON ocr_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_ocr_documents_status ON ocr_documents(extraction_status);
CREATE INDEX IF NOT EXISTS idx_ocr_document_lines_document ON ocr_document_lines(ocr_document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_document_lines_product_code ON ocr_document_lines(product_code);
CREATE INDEX IF NOT EXISTS idx_ocr_business_matches_document ON ocr_business_matches(ocr_document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_business_matches_target ON ocr_business_matches(target_type, target_id);

-- OCR feedback: user corrections are operational data and are accessed only by the API.
CREATE TABLE IF NOT EXISTS ocr_feedbacks (
    id BIGSERIAL PRIMARY KEY,
    engine VARCHAR(50) NOT NULL,
    original_text TEXT NOT NULL,
    corrected_text TEXT NOT NULL,
    confidence DOUBLE PRECISION,
    accuracy DOUBLE PRECISION NOT NULL,
    image_hash VARCHAR(64),
    document_type VARCHAR(50) NOT NULL DEFAULT 'unknown',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ocr_feedbacks_confidence_range CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),
    CONSTRAINT ocr_feedbacks_accuracy_range CHECK (accuracy BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_ocr_feedbacks_engine ON ocr_feedbacks (engine);
CREATE INDEX IF NOT EXISTS idx_ocr_feedbacks_document_type ON ocr_feedbacks (document_type);
CREATE INDEX IF NOT EXISTS idx_ocr_feedbacks_created_at ON ocr_feedbacks (created_at DESC);

GRANT ALL PRIVILEGES ON ocr_feedbacks TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE ocr_feedbacks_id_seq TO production_user;

INSERT INTO ocr_documents
    (document_no, document_type, source_engine, raw_text, normalized_text, confidence, extraction_status, extracted_data, notes)
VALUES
    ('OCR-REVIEW-001', 'sales_order', 'sample', '注文番号: OCR-SO-001
顧客名: POC 顧客
希望出荷日: 2026-07-20
PROD001 製品A 2
PROD002 製品B 1', '注文番号: OCR-SO-001
顧客名: POC 顧客
希望出荷日: 2026-07-20
PROD001 製品A 2
PROD002 製品B 1', 90.00, 'parsed', '{"sales_order_no":"OCR-SO-001","customer_name":"POC 顧客","requested_ship_date":"2026-07-20"}'::jsonb, 'Phase 5 OCR サンプル')
ON CONFLICT (document_no) DO NOTHING;

GRANT ALL PRIVILEGES ON ocr_documents TO production_user;
GRANT ALL PRIVILEGES ON ocr_document_lines TO production_user;
GRANT ALL PRIVILEGES ON ocr_business_matches TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE ocr_documents_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE ocr_document_lines_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE ocr_business_matches_id_seq TO production_user;

-- Phase 6: 製造指図・工程実績
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

GRANT ALL PRIVILEGES ON manufacturing_processes TO production_user;
GRANT ALL PRIVILEGES ON manufacturing_orders TO production_user;
GRANT ALL PRIVILEGES ON manufacturing_order_operations TO production_user;
GRANT ALL PRIVILEGES ON manufacturing_material_consumptions TO production_user;
GRANT ALL PRIVILEGES ON manufacturing_receipts TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_processes_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_orders_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_order_operations_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_material_consumptions_id_seq TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE manufacturing_receipts_id_seq TO production_user;
