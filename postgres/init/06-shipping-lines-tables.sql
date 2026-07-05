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
