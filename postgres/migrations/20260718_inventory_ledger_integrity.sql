-- 追記型在庫台帳の整合性強化。

ALTER TABLE inventory_transactions
    ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(30) NOT NULL DEFAULT 'available';

ALTER TABLE receiving_results
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_receiving_results_idempotency
ON receiving_results (receiving_order_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

UPDATE inventory_transactions
SET inventory_status = 'on_hold'
WHERE transaction_type = 'hold'
  AND inventory_status <> 'on_hold';

UPDATE inventory_transactions
SET inventory_status = 'defective'
WHERE transaction_type = 'defective'
  AND inventory_status <> 'defective';

-- 製造払出は available 在庫からの減算であり、移動種別と残高状態を分離する。
UPDATE inventory_transactions
SET inventory_status = 'available'
WHERE transaction_type = 'manufacturing_consumption'
  AND inventory_status = 'consumed';

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_balance_key_v2
ON inventory_transactions (
    product_id,
    COALESCE(lot_number, ''),
    COALESCE(location_code, ''),
    COALESCE(qr_unit_id, 0),
    inventory_status
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inventory_balances_nonnegative'
          AND conrelid = 'inventory_balances'::regclass
    ) THEN
        ALTER TABLE inventory_balances
            ADD CONSTRAINT ck_inventory_balances_nonnegative CHECK (quantity >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'production_user') THEN
        GRANT ALL PRIVILEGES ON TABLE inventory_transactions TO production_user;
        GRANT ALL PRIVILEGES ON TABLE inventory_balances TO production_user;
    END IF;
END $$;
