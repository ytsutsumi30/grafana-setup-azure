-- QC七つ道具用サンプルデータ生成スクリプト
-- 過去30日分の検品データを生成

-- 既存のサンプルデータを削除（クリーンアップ）
DELETE FROM qr_inspection_details WHERE qr_inspection_id IN (
    SELECT id FROM qr_inspections WHERE inspector_name LIKE 'サンプル%'
);
DELETE FROM qr_inspections WHERE inspector_name LIKE 'サンプル%';

-- 過去30日分の検品データを生成
DO $$
DECLARE
    v_date DATE;
    v_inspection_id INTEGER;
    v_product_id INTEGER;
    v_shipping_instruction_id INTEGER;
    v_total_components INTEGER;
    v_scanned_components INTEGER;
    v_component_id INTEGER;
    v_error_messages TEXT[] := ARRAY[
        '部品欠品',
        '外観不良',
        '数量不一致',
        'QRコード読み取り不可',
        '梱包不良',
        '製品破損',
        'ラベル貼付不良',
        '仕様違い'
    ];
    v_error_msg TEXT;
    v_inspection_time INTERVAL;
    v_is_failed BOOLEAN;
    v_inspections_per_day INTEGER;
    i INTEGER;
    j INTEGER;
BEGIN
    -- 過去30日分のデータを生成
    FOR day_offset IN 0..29 LOOP
        v_date := CURRENT_DATE - day_offset;
        v_inspections_per_day := 3 + (RANDOM() * 7)::INTEGER; -- 3〜10件/日

        FOR i IN 1..v_inspections_per_day LOOP
            -- ランダムに製品と出荷指示を選択
            SELECT id INTO v_product_id FROM products ORDER BY RANDOM() LIMIT 1;
            SELECT id INTO v_shipping_instruction_id FROM shipping_instructions ORDER BY RANDOM() LIMIT 1;

            -- 検品時間をランダムに生成（5〜30分）
            v_inspection_time := (5 + RANDOM() * 25)::INTEGER || ' minutes';

            -- 失敗か成功かをランダムに決定（10%の確率で失敗）
            v_is_failed := RANDOM() < 0.1;

            -- 製品の総部品数を取得
            SELECT COUNT(*) INTO v_total_components
            FROM product_components
            WHERE product_id = v_product_id;

            IF v_total_components = 0 THEN
                v_total_components := 3; -- デフォルト値
            END IF;

            -- スキャンした部品数（失敗の場合は少なめ）
            IF v_is_failed THEN
                v_scanned_components := v_total_components - (1 + (RANDOM() * 2)::INTEGER);
            ELSE
                v_scanned_components := v_total_components;
            END IF;

            -- QR検品レコードを挿入
            INSERT INTO qr_inspections (
                shipping_instruction_id,
                inspector_name,
                product_id,
                total_components,
                scanned_components,
                passed_quantity,
                status,
                created_at,
                completed_at
            ) VALUES (
                v_shipping_instruction_id,
                'サンプル検品員' || (1 + (RANDOM() * 5)::INTEGER),
                v_product_id,
                v_total_components,
                v_scanned_components,
                CASE WHEN v_is_failed THEN 0 ELSE 1 END,
                CASE WHEN v_is_failed THEN 'failed' ELSE 'completed' END,
                v_date + (8 + RANDOM() * 10)::INTEGER || ' hours',
                v_date + (8 + RANDOM() * 10)::INTEGER || ' hours' + v_inspection_time
            ) RETURNING id INTO v_inspection_id;

            -- 検品詳細データを挿入
            FOR j IN 1..v_total_components LOOP
                -- 部品IDを取得
                SELECT id INTO v_component_id
                FROM product_components
                WHERE product_id = v_product_id
                LIMIT 1 OFFSET (j - 1);

                IF v_component_id IS NULL THEN
                    CONTINUE;
                END IF;

                -- 失敗検品の場合、一部をエラーとして記録
                IF v_is_failed AND j > v_scanned_components THEN
                    v_error_msg := v_error_messages[1 + (RANDOM() * (ARRAY_LENGTH(v_error_messages, 1) - 1))::INTEGER];

                    INSERT INTO qr_inspection_details (
                        qr_inspection_id,
                        product_component_id,
                        qr_code,
                        status,
                        error_message,
                        scanned_at
                    ) VALUES (
                        v_inspection_id,
                        v_component_id,
                        'QR-ERROR-' || j,
                        'error',
                        v_error_msg,
                        v_date + (8 + RANDOM() * 10)::INTEGER || ' hours' + ((j - 1) * 30)::INTEGER || ' seconds'
                    );
                ELSE
                    -- 正常スキャン
                    INSERT INTO qr_inspection_details (
                        qr_inspection_id,
                        product_component_id,
                        qr_code,
                        status,
                        scanned_at
                    ) VALUES (
                        v_inspection_id,
                        v_component_id,
                        'QR-OK-' || j,
                        'scanned',
                        v_date + (8 + RANDOM() * 10)::INTEGER || ' hours' + ((j - 1) * 30)::INTEGER || ' seconds'
                    );
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'サンプルデータの生成が完了しました';
END $$;

-- 生成されたデータの確認
SELECT
    DATE(completed_at) as date,
    COUNT(*) as total_inspections,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM qr_inspections
WHERE inspector_name LIKE 'サンプル%'
GROUP BY DATE(completed_at)
ORDER BY date DESC
LIMIT 10;
