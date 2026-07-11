# Phase 4: 棚卸 設計

## 目的

在庫・ロット・QR 共通基盤を使い、理論在庫と現物数量の差異を記録し、承認後に在庫へ反映する。POC では API と DB を先に整備し、画面は次ステップで追加する。

## 対象業務

- 棚卸セッションを開始する。
- 開始時点の `inventory_balances` を棚卸明細へスナップショットする。
- QR コードまたは品目・ロット・保管場所単位で実数を記録する。
- 理論数量と実数の差異を算出する。
- 棚卸完了後、承認操作で差異を在庫調整として反映する。
- 操作は `operation_events` と `inventory_transactions` に残す。

## データ設計

- `inventory_count_sessions`
  - 棚卸番号、名称、対象保管場所、状態、開始・完了・承認日時を保持する。
- `inventory_count_lines`
  - 品目、ロット、QR、保管場所、理論数量、実数、差異を保持する。
- `inventory_adjustments`
  - 承認済み差異調整と、対応する `inventory_transactions` を保持する。

## API 設計

- `GET /api/inventory-counts`
  - 棚卸一覧を返す。
- `GET /api/inventory-counts/:id`
  - 棚卸ヘッダと明細を返す。
- `POST /api/inventory-counts`
  - 棚卸を開始し、理論在庫を明細へスナップショットする。
- `POST /api/inventory-counts/:id/scan`
  - QR または品目・ロット単位で実数を記録する。
- `PATCH /api/inventory-counts/:id/complete`
  - 棚卸入力を完了状態にする。
- `PATCH /api/inventory-counts/:id/approve`
  - 差異を `inventory_transactions` と `inventory_balances` へ反映する。

## ステータス

- `draft`: 作成直後
- `in_progress`: 棚卸中
- `counted`: 入力完了
- `approved`: 差異承認済み

## POC 方針

- 不明 QR は 404 とし、未登録 QR の新規作成は行わない。
- 実数入力はスキャンごとに最新値へ上書きする。
- 承認後の修正は別セッションで扱う。
- ロット・QR の数量は差異分だけ増減し、0 未満にはしない。

## 次ステップ

画面側では、棚卸一覧、棚卸開始、QR スキャン入力、差異一覧、承認ボタンを追加する。現場利用では差異理由分類と承認者入力を必須にする。
