# Phase 3: 受注・出荷指示生成 設計

## 目的

受注を起点に、既存の出荷検品アプリで扱える出荷指示を生成する。POC では受注登録、受注明細登録、出荷指示生成までを対象とし、在庫引当の自動最適化は次フェーズで扱う。

## 業務範囲

- 受注ヘッダを登録する。
- 受注は 1 から N 件の品目明細を持つ。
- 受注から出荷指示を生成する。
- 出荷指示は既存の `shipping_instructions` をヘッダとして利用する。
- 複数品目は既存の `shipping_instruction_lines` に展開する。
- 出荷指示生成後は、既存の PPS、ロット引当、QR 検品、出荷完了フローへ接続する。

## データ設計

### 追加テーブル

- `sales_orders`
  - 受注番号、顧客名、受注日、希望出荷日、出荷元、納品先、優先度、ステータスを保持する。
- `sales_order_lines`
  - 受注明細として品目、受注数量、出荷済み数量、ステータスを保持する。

### 既存テーブルへの追加

- `shipping_instructions.sales_order_id`
  - 出荷指示がどの受注から生成されたかを保持する。
- `shipping_instruction_lines.sales_order_line_id`
  - 出荷指示明細がどの受注明細から生成されたかを保持する。

## API 設計

- `GET /api/sales-orders`
  - 受注一覧を返す。
- `GET /api/sales-orders/:id`
  - 受注ヘッダ、受注明細、生成済み出荷指示を返す。
- `POST /api/sales-orders`
  - 受注と受注明細を登録する。
- `POST /api/sales-orders/:id/create-shipping-instruction`
  - 受注から出荷指示を生成する。

## 既存互換方針

既存の画面と API は `shipping_instructions.product_id` と `quantity` を参照する箇所が残っている。そのため、受注から出荷指示を生成するときは以下の互換値を入れる。

- `product_id`: 先頭明細の品目 ID
- `quantity`: 全明細の合計数量

正規の複数品目情報は `shipping_instruction_lines` を正とする。

## 次フェーズへの接続

次の実装では、生成された出荷指示明細に対して、在庫・ロット・QR 共通基盤から候補ロットを提示し、ロット引当を行う。これにより、受注から出荷完了までの流れがつながる。
