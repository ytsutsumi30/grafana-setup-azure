# Phase 6: 製造指図・工程実績 設計

## 目的

生産計画と既存在庫・QR 基盤を接続し、製造指図、工程実績、部品消費、完成品入庫を記録できるようにする。

## 対象範囲

- 工程マスタを管理する。
- 製造指図を発行する。
- 製造指図に標準工程を展開する。
- 工程開始・完了を記録する。
- 部品 QR またはロットを消費し、在庫履歴へ反映する。
- 完成品ロットと QR を作成し、完成品在庫として入庫する。
- 操作は `operation_events` と `inventory_transactions` に残す。

## 追加テーブル

- `manufacturing_processes`
  - 工程マスタ。
- `manufacturing_orders`
  - 製造指図ヘッダ。
- `manufacturing_order_operations`
  - 指図別工程。
- `manufacturing_material_consumptions`
  - 部品消費実績。
- `manufacturing_receipts`
  - 完成品入庫実績。

## API

- `GET /api/manufacturing-orders`
  - 製造指図一覧を返す。
- `GET /api/manufacturing-orders/:id`
  - 指図、工程、部品消費、完成入庫を返す。
- `POST /api/manufacturing-orders`
  - 製造指図を発行し、標準工程を展開する。
- `PATCH /api/manufacturing-orders/:id/operations/:operationId/start`
  - 工程を開始する。
- `PATCH /api/manufacturing-orders/:id/operations/:operationId/complete`
  - 工程を完了する。
- `POST /api/manufacturing-orders/:id/consume-material`
  - 部品ロットまたは QR を消費し、在庫を減算する。
- `POST /api/manufacturing-orders/:id/receive-finished-good`
  - 完成品ロットと QR を作成し、在庫を増加する。

## POC 方針

- `product_components` を簡易 BOM として扱う。
- 実際の部品品目マスタ連携は後続で強化する。
- 部品消費は QR があれば QR を正、なければ品目・ロットを正とする。
- 完成品入庫は `lot_inventory`、`qr_units`、`inventory_transactions`、`inventory_balances` へ反映する。
- 指図完了は完成品入庫時に自動更新する。

## 次ステップ

次フェーズのトレーサビリティで、製造指図、部品ロット、完成品ロット、出荷先を横断検索できるようにする。
