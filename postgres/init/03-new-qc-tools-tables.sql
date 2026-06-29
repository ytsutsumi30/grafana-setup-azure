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
GRANT ALL PRIVILEGES ON TABLE qc_analysis_projects TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_affinity_cards TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_relation_nodes TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_relation_edges TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_tree_nodes TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_matrix_items TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_matrix_cells TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_matrix_data_analysis TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_arrow_tasks TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_arrow_dependencies TO production_user;
GRANT ALL PRIVILEGES ON TABLE qc_pdpc_nodes TO production_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO production_user;
