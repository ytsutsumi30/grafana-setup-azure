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
