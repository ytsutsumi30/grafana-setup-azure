# Phase 7: トレーサビリティ 設計

## 目的

受注、出荷、発注、入庫、製造、在庫、QR、ロットを横断して追跡できるようにする。POC では既存テーブルに新規キーを追加せず、各業務で記録済みの番号、ロット番号、QRコード、`operation_events`、`inventory_transactions` を束ねる API を提供する。

## 追跡起点

- ロット番号
- QR コード
- 業務番号
  - 受注番号
  - 出荷指示番号
  - 発注番号
  - 入庫予定番号
  - 製造指図番号
  - OCR 文書番号

## API

- `GET /api/traceability/lot/:lotNumber`
  - ロットに関係する在庫履歴、入庫、製造消費、製造入庫、出荷ロット引当、業務イベントを返す。
- `GET /api/traceability/qr/:qrCode`
  - QR 単位の履歴と、その QR が属するロットの履歴を返す。
- `GET /api/traceability/document/:documentNo`
  - 業務番号から関連する受注、出荷指示、発注、入庫予定、製造指図、OCR 文書、業務イベントを返す。
- `GET /api/traceability/search?q=...`
  - ロット、QR、受注、出荷指示、発注、製造指図を横断検索する。

## データ参照方針

- 在庫増減は `inventory_transactions` を正とする。
- 業務操作は `operation_events` を正とする。
- QR 個体は `qr_units` を正とする。
- ロット在庫は `lot_inventory` を既存互換の現在値として扱う。
- 出荷との接続は `shipping_lot_allocations` を優先する。
- 製造との接続は `manufacturing_material_consumptions` と `manufacturing_receipts` を使う。

## POC の制約

- 既存出荷検品の一部履歴はロット番号文字列で接続する。
- 完全な親子ロットツリーはまだ作らない。
- 製造で使用した部品ロットと完成品ロットの明示的な親子関係テーブルは次の改善候補とする。

## 次ステップ

次に強化する場合は、`lot_genealogy` のような専用テーブルを追加し、製造消費ロットと完成品ロットの関係を保存する。これにより、完成品ロットから部品ロットへ、部品ロットから出荷先へ、より厳密に正逆展開できる。
