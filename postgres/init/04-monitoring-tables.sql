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
GRANT ALL PRIVILEGES ON TABLE metrics_timeseries TO production_user;
GRANT ALL PRIVILEGES ON TABLE inventory_snapshots TO production_user;
GRANT ALL PRIVILEGES ON TABLE inspection_performance_hourly TO production_user;
GRANT ALL PRIVILEGES ON TABLE monitoring_alerts TO production_user;
GRANT ALL PRIVILEGES ON TABLE demand_forecast TO production_user;
GRANT ALL PRIVILEGES ON TABLE abc_analysis TO production_user;

GRANT SELECT ON v_inventory_health TO production_user;
GRANT SELECT ON v_inspector_performance TO production_user;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO production_user;
