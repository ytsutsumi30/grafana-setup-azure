# Phase 2 発注・入庫 MVP 実装計画

作成日: 2026-07-08

## 目的

推奨実装順の 2 番目として、発注から入庫予定、QR 入庫検品、在庫反映までの最小業務フローを実装する。

## 今回の対象

- 仕入先マスタ
- 発注ヘッダ、発注明細
- 発注から入庫予定生成
- 入庫予定明細
- QR 入庫検品
- ロット在庫への反映
- QR 管理単位への反映
- `inventory_transactions` / `inventory_balances` への反映
- `operation_events` への記録

## 追加 API

```text
GET  /api/suppliers
POST /api/suppliers

GET  /api/purchase-orders
GET  /api/purchase-orders/:id
POST /api/purchase-orders
POST /api/purchase-orders/:id/create-receiving-order

GET   /api/receiving-orders
GET   /api/receiving-orders/:id
POST  /api/receiving-orders/:id/scan
PATCH /api/receiving-orders/:id/complete
```

## POC 方針

- 入庫時にロット番号を指定する。
- QR コードは任意。指定された場合は `qr_units` に登録する。
- 合格数量だけを利用可能在庫へ反映する。
- 不合格数量は入庫結果には残すが、Phase 2 MVP では不良在庫バランスにはまだ反映しない。
- 発注、入庫予定、入庫検品はすべて `operation_events` に記録する。

## 後続タスク

1. 発注・入庫の画面を追加する。
2. 入庫レビュー用デモデータと API 通し実行スクリプトを追加する。
3. 不合格、保留在庫のステータス別バランス反映を追加する。
4. 納品書 OCR 照合へ接続する。
