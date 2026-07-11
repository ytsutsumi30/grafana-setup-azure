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

GRANT ALL PRIVILEGES ON TABLE shipping_audit_events TO production_user;
GRANT ALL PRIVILEGES ON SEQUENCE shipping_audit_events_id_seq TO production_user;
