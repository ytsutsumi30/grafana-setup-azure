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
