-- Phase 5: OCR 取込
-- OCR テキストを業務候補へ変換し、受注候補・納品書照合候補として保存する。

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

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'production_user') THEN
        GRANT ALL PRIVILEGES ON TABLE ocr_documents TO production_user;
        GRANT ALL PRIVILEGES ON TABLE ocr_document_lines TO production_user;
        GRANT ALL PRIVILEGES ON TABLE ocr_business_matches TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE ocr_documents_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE ocr_document_lines_id_seq TO production_user;
        GRANT ALL PRIVILEGES ON SEQUENCE ocr_business_matches_id_seq TO production_user;
    END IF;
END $$;
