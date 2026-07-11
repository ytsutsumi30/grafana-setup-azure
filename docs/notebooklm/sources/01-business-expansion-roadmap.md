# 出荷検品アプリ 業務拡張ロードマップ

作成日: 2026-07-08

## 目的

既存の出荷検品アプリを核に、受注、発注、入庫、在庫、棚卸、製造指図、トレーサビリティ、監視まで段階的に拡張する。

この文書は、以下の既存計画を横断し、今後の実装順序を決めるためのロードマップとする。

- `docs/documentation-policy.md`
- `docs/business-expansion-roadmap.html`
- `docs/plans.html`
- `docs/shipping-inspection-next-plan.md`
- `docs/manufacturing-inventory-plan.md`
- `docs/manufacturing-order-plan.md`
- `docs/grafana-embedding-plan.md`
- `docs/field-review-runbook.md`
- `docs/inventory-foundation-phase1-plan.md`
- `docs/purchase-receiving-phase2-plan.md`
- `docs/sales-order-shipping-phase3-plan.md`
- `docs/inventory-count-phase4-plan.md`
- `docs/grafana-cloud-minimal-monitoring.md`
- `docs/ocr-import-phase5-plan.md`
- `docs/manufacturing-orders-phase6-plan.md`
- `docs/traceability-phase7-plan.md`

## 既存計画の確認結果

`docs/plans.html` は、2026-07-05 時点の拡張計画ポータルであり、次の領域を整理済み。

- 入庫、在庫、棚卸
- 受発注、製造指図
- Grafana 埋め込み
- UI 改善
- Skills 導入

ただし、その後に出荷検品側で次の実装が進んでいる。

- 複数品目、複数ロットの PPS / QR 検品
- QR 個体 ID 分離
- 出荷監査イベント
- 出荷履歴
- 出荷検品結果票、ロット別出荷実績票
- 現場レビュー用データ、API リハーサル、証跡収集

したがって、今後の拡張は `plans.html` の大枠を維持しつつ、出荷検品で確立した設計を他業務へ横展開する。

## 基本方針

1. いきなり ERP 全体を作らない。
2. 現在動いている出荷検品を業務イベント、ロット、QR、履歴、帳票の参照実装とする。
3. 在庫台帳を先に固め、受注、発注、製造指図は在庫台帳へ接続する。
4. QR は全業務で共通の現物識別子として扱う。
5. 監査ログと業務イベントを全業務で共通化する。
6. POC ではロールを細かく分けず、M365 ログインユーザーを同一権限として扱う。
7. Azure Container Apps + Supabase を継続し、Grafana Cloud は監視、OSS Grafana は将来の画面埋め込み候補とする。
8. 基本文書は日本語で作成し、図表が必要なロードマップ、構成図、業務フローは HTML First で作成する。

## 拡張後の業務全体像

```text
受注
  -> 出荷指示
  -> ロット引当
  -> PPS / QR 検品
  -> 出荷完了
  -> 出荷履歴 / 帳票 / 監査ログ

発注
  -> 入庫予定
  -> QR 入庫検品
  -> ロット / QR 在庫
  -> 納品書 OCR 照合
  -> 発注残更新

製造指図
  -> BOM 展開
  -> 部品 QR 消費
  -> 工程 QR 打刻
  -> 完成品ロット作成
  -> 完成品入庫

棚卸
  -> 棚卸計画
  -> QR スキャン棚卸
  -> 差異確認
  -> 承認後在庫調整

横断
  -> ロットトレーサビリティ
  -> 業務イベント
  -> Grafana Cloud 監視
```

## 現在の実装資産

### そのまま再利用する資産

| 資産 | 再利用先 |
|------|----------|
| `products` | 品目マスタの初期版 |
| `product_components` | BOM / 構成マスタの初期版 |
| `lot_inventory` | ロット在庫の暫定台帳 |
| `qr_units` | QR 個体 ID 管理 |
| `shipping_instruction_lines` | 複数明細伝票の実装例 |
| `shipping_lot_allocations` | ロット引当の実装例 |
| `picking_records` | QR スキャン実績の実装例 |
| `shipping_audit_events` | 業務イベント監査ログの実装例 |
| `shipping-history.html` | 履歴画面の実装例 |
| `shipping-report.html` | HTML 帳票の実装例 |
| M365 認証 | 全業務画面/API の認証基盤 |

### 整理が必要な資産

| 領域 | 課題 |
|------|------|
| `inventory` と `lot_inventory` | 既存の簡易在庫とロット在庫が並立している |
| `production_plans` | 生産計画はあるが、製造指図、工程実績、部品消費と未接続 |
| OCR ルート | 注文書、納品書の業務確認画面が未整備 |
| `monitoring` | 既存の分析 API はあるが、業務イベント統合メトリクスが未整備 |
| `docs/plans.html` | 出荷検品 Phase 1-5 完了後の状態が未反映 |

## 優先順位

### 最優先: 在庫台帳の確立

受注、発注、製造指図のどれを作っても、最終的には在庫に接続する。

そのため、最初に以下を固める。

- 品目
- ロット
- QR 管理単位
- 保管場所
- 在庫ステータス
- 在庫変動履歴
- 業務イベント

### 次点: 発注から入庫

入庫は在庫を増やす入口であり、出荷検品の QR パターンを流用しやすい。

POC では、発注管理を最初から高度化せず、まず発注明細から入庫予定を作る。

### 次点: 受注から出荷指示

出荷検品はすでに動いているため、受注から出荷指示を生成できると、販売側の業務フローが閉じる。

### 後続: 製造指図

製造指図は BOM、部品消費、工程、完成品入庫が絡むため、在庫台帳が安定してから着手する。

## フェーズ計画

### Phase 0: 現状整理と設計確定

目的:

出荷検品で確立したパターンを、在庫、受発注、製造へ横展開するための土台を決める。

実施内容:

- `docs/plans.html` の位置づけを「旧統合ビュー」として整理する。
- このロードマップを実装順序の基準にする。
- 現行 DB の棚卸を行う。
- `inventory`、`lot_inventory`、`qr_units` の統合方針を決める。
- `shipping_audit_events` を拡張するか、共通 `operation_events` を新設するか決める。

完了条件:

- DB 統合方針が決まっている。
- 新規テーブル名、既存テーブル流用方針が決まっている。
- 出荷検品以外の最初の実装対象が確定している。

### Phase 1: 在庫・ロット・QR 共通基盤

目的:

すべての業務が参照する在庫台帳を作る。

詳細設計:

- `docs/inventory-foundation-phase1-plan.md`

実施内容:

- `locations` を追加する。
- `inventory_transactions` を追加する。
- `inventory_balances` を追加する。
- `lot_inventory` と `qr_units` を新台帳へ接続する。
- 入出庫、移動、調整の履歴を追記型で記録する。
- QR 単位のステータスを統一する。

優先 API:

```text
GET    /api/inventory/balances
GET    /api/inventory/transactions
GET    /api/lots
GET    /api/lots/:id
GET    /api/qr-units/:qrCode
POST   /api/inventory-moves
POST   /api/inventory-adjustments
```

優先画面:

- 在庫一覧
- ロット別在庫
- QR 単位在庫
- 在庫変動履歴

完了条件:

- 品目、ロット、QR、保管場所、ステータス別に在庫を確認できる。
- 在庫変動が追記型で残る。
- 出荷検品のロット引当が新しい在庫履歴と矛盾しない。

### Phase 2: 発注・入庫

目的:

発注から入庫予定、QR 入庫検品、在庫反映までを作る。

詳細設計:

- `docs/purchase-receiving-phase2-plan.md`

実施内容:

- `suppliers` を追加する。
- `purchase_orders` / `purchase_order_lines` を追加する。
- `receiving_orders` / `receiving_order_lines` を追加する。
- 入庫時にロットと QR を作成する。
- QR 入庫検品で合格、保留、不合格を記録する。
- 入庫結果を `inventory_transactions` に反映する。

優先 API:

```text
GET    /api/suppliers
POST   /api/suppliers
GET    /api/purchase-orders
POST   /api/purchase-orders
POST   /api/purchase-orders/:id/create-receiving-order
GET    /api/receiving-orders
POST   /api/receiving-orders/:id/scan
PATCH  /api/receiving-orders/:id/complete
```

優先画面:

- 発注一覧
- 発注登録
- 入庫予定一覧
- QR 入庫検品
- 入庫履歴

POC で後回し:

- 承認ワークフロー
- 分納の詳細請求処理
- 単価差異の会計連携

完了条件:

- 発注から入庫予定を生成できる。
- QR スキャンで入庫検品できる。
- 合格入庫が利用可能在庫として増える。
- 入庫イベントが監査ログに残る。

### Phase 3: 受注・出荷指示生成

目的:

受注から既存の出荷検品へ接続する。

実施内容:

- `customers` を追加する。
- `sales_orders` / `sales_order_lines` を追加する。
- 受注残を表示する。
- 受注明細から `shipping_instructions` と `shipping_instruction_lines` を生成する。
- 生成後は既存 PPS / QR 検品フローへ渡す。

優先 API:

```text
GET    /api/customers
POST   /api/customers
GET    /api/sales-orders
POST   /api/sales-orders
GET    /api/sales-orders/backlog
POST   /api/sales-orders/:id/create-shipping-instructions
```

優先画面:

- 受注一覧
- 受注登録
- 受注残一覧
- 出荷指示生成

完了条件:

- 受注を登録できる。
- 受注残を確認できる。
- 受注から出荷指示を生成できる。
- 生成された出荷指示を既存 PPS / QR 検品で処理できる。

### Phase 4: 棚卸

目的:

QR を使って現物確認し、理論在庫との差異を扱う。

実施内容:

- `inventory_counts` / `inventory_count_lines` を追加する。
- 棚卸対象を保管場所、品目、ロットで指定する。
- QR スキャンで実在庫を記録する。
- 未スキャン QR、不明 QR、数量差異を検出する。
- 承認後に在庫調整を反映する。

優先 API:

```text
POST   /api/inventory-counts
GET    /api/inventory-counts
GET    /api/inventory-counts/:id
POST   /api/inventory-counts/:id/scans
GET    /api/inventory-counts/:id/differences
PATCH  /api/inventory-counts/:id/close
```

優先画面:

- 棚卸計画一覧
- QR 棚卸
- 差異確認
- 調整承認

完了条件:

- QR 棚卸ができる。
- 未スキャンと不明 QR を検出できる。
- 差異が承認後に在庫へ反映される。

### Phase 5: OCR 取込

目的:

注文書と納品書の入力負荷を下げる。

実施内容:

- `ocr_documents` を追加する。
- 注文書 OCR 取込を受注登録へ接続する。
- 納品書 OCR 取込を発注明細照合へ接続する。
- OCR 結果は必ず確認、修正画面を経由する。

優先 API:

```text
POST   /api/ocr-documents
GET    /api/ocr-documents/:id
PATCH  /api/ocr-documents/:id
POST   /api/ocr-documents/:id/confirm-as-sales-order
POST   /api/ocr-documents/:id/match-delivery-note
```

完了条件:

- 注文書 OCR から受注候補を作れる。
- 納品書 OCR と発注明細を照合できる。
- 修正前後の差分が記録される。

### Phase 6: 製造指図・工程実績

目的:

製造現場の進捗、部品消費、完成品ロットを管理する。

実施内容:

- `work_orders` を追加する。
- `work_order_operations` を追加する。
- `work_order_components` を追加する。
- `operation_results` を追加する。
- `material_consumptions` を追加する。
- BOM は既存 `product_components` を初期版として流用する。
- 部品 QR を消費し、完成品ロットを入庫する。

優先 API:

```text
GET    /api/work-orders
POST   /api/work-orders
PATCH  /api/work-orders/:id/release
POST   /api/operation-results/scan
POST   /api/material-consumptions/scan
PATCH  /api/work-orders/:id/complete
```

優先画面:

- 製造指図一覧
- 指図詳細
- 工程 QR 打刻
- 部品消費スキャン
- 製造進捗ボード

完了条件:

- 製造指図を発行できる。
- 工程開始、完了を QR で記録できる。
- 部品 QR 消費が在庫履歴へ反映される。
- 完成品ロットを作成し、在庫へ入庫できる。

### Phase 7: トレーサビリティ

目的:

ロット起点で、入庫、製造、出荷、顧客まで追跡する。

実施内容:

- ロット正展開 API を作る。
- ロット逆展開 API を作る。
- 受注番号、発注番号、製造指図番号、出荷指示番号で横断検索する。
- 出荷履歴画面のパターンを流用してトレース画面を作る。

優先 API:

```text
GET /api/traceability/lot/:lotId/backward
GET /api/traceability/lot/:lotId/forward
GET /api/traceability/search
```

完了条件:

- 製品ロットから使用部品ロットを追える。
- 部品ロットから出荷先を追える。
- 受注、発注、製造指図、出荷指示を横断表示できる。

### Phase 8: Grafana Cloud / 監視

目的:

技術監視と業務監視を統合する。

実施内容:

- `/metrics` を追加する。
- 業務イベントからメトリクスを作る。
- Grafana Cloud に送る。
- 現場向けには必要に応じて OSS Grafana 埋め込みを検討する。

優先メトリクス:

```text
shipping_completed_total
qr_scan_ng_total
inventory_transactions_total
receiving_completed_total
inventory_count_difference_total
sales_order_backlog_count
purchase_order_backlog_count
work_order_delayed_count
ocr_correction_fields_total
```

完了条件:

- API / DB のヘルスを監視できる。
- 出荷、入庫、棚卸、受注残、発注残、工程遅延を Grafana Cloud で確認できる。
- 主要アラートが設定されている。

## 実装順序の推奨

POC として最も現実的な順序は次の通り。

1. Phase 0: 現状整理と設計確定
2. Phase 1: 在庫・ロット・QR 共通基盤
3. Phase 2: 発注・入庫
4. Phase 3: 受注・出荷指示生成
5. Phase 4: 棚卸
6. Phase 8 の一部: Grafana Cloud 最小監視
7. Phase 5: OCR 取込
8. Phase 6: 製造指図・工程実績
9. Phase 7: トレーサビリティ

理由:

- 在庫基盤がないと、発注、入庫、製造、棚卸がすべて暫定実装になる。
- 入庫は出荷検品の QR スキャン設計を流用しやすい。
- 受注は既存出荷指示へ接続すれば効果が早い。
- 製造指図は部品消費と完成品入庫が絡むため、後段にする。

## 直近 4 週間の次アクション

### Week 1: 設計確定

- 現行 DB テーブルの棚卸。
- `inventory` と `lot_inventory` の統合方針を決定。
- `shipping_audit_events` と `operation_events` の関係を決定。
- Phase 1 の DB スキーマを作成。

### Week 2: 在庫基盤

- `locations`、`inventory_transactions`、`inventory_balances` を追加。
- 既存 `lot_inventory` / `qr_units` から初期在庫を同期するスクリプトを作成。
- 在庫 API の読み取り系を追加。
- 契約テストを追加。

### Week 3: 発注・入庫 MVP

- `suppliers`、`purchase_orders`、`purchase_order_lines` を追加。
- 発注一覧、発注登録 API を追加。
- 入庫予定生成 API を追加。
- QR 入庫検品の最小 API を追加。

### Week 4: 画面とレビュー

- 発注一覧、入庫予定一覧、QR 入庫検品画面を追加。
- ローカルレビュー用デモデータを追加。
- API 通し実行スクリプトを追加。
- 現場レビュー Runbook を作成。

## 重要な設計判断

### 在庫台帳

既存の `lot_inventory` は出荷検品のロット引当で使われているため、すぐに廃止しない。

POC では次の順で移行する。

1. `lot_inventory` を既存互換ロット在庫として維持。
2. `inventory_transactions` を追加し、以後の増減を追記型にする。
3. `inventory_balances` を追加し、集計済み現在庫を持つ。
4. 出荷、入庫、棚卸、製造消費をすべて `inventory_transactions` へ寄せる。
5. 安定後に `lot_inventory` をビューまたは互換テーブル扱いへ下げる。

### 業務イベント

出荷検品では `shipping_audit_events` が実装済み。

全業務共通では `operation_events` を追加するのが望ましい。

移行方針:

- 出荷検品は当面 `shipping_audit_events` を維持する。
- 新規業務は `operation_events` に記録する。
- Grafana Cloud 用メトリクスは両方を集約する。
- 将来、`shipping_audit_events` を `operation_events` へ統合する。

### QR 管理

QR コードはロット番号ではなく、現物識別子として扱う。

原則:

- QR は短い ID のみを保持する。
- 業務情報は DB で引く。
- QR は品目、ロット、数量、保管場所、状態に紐づく。
- QR スキャンは OK / NG / duplicate / unknown を必ずイベント化する。

### 帳票

出荷検品と同じく、POC では HTML 印刷とブラウザ PDF 保存を正式運用とする。

後続の候補:

- 発注書
- 入庫検品票
- 棚卸差異票
- 製造指図票
- 工程実績票
- ロットトレーサビリティ票

## 後回しにする項目

- EDI / ERP 連携
- 原価計算
- 請求、売掛、買掛
- 多段階承認
- 本格 MRP
- 小日程計画、負荷山積み
- 設備保全
- CAPA / NCR
- ラベルプリンタ機種別の専用制御

## 次に実装するなら

最初の実装アクションは、Phase 1 の在庫・ロット・QR 共通基盤とする。

具体的には次の順で進める。

1. DB スキーマ案を `postgres/migrations` と `supabase-schema.sql` に追加する。
2. `inventory_transactions` へ出荷検品のロット引当、QR 検品、出荷完了イベントを接続する。
3. `inventory_balances` を再計算するローカルスクリプトを作る。
4. 読み取り API と契約テストを追加する。
5. 在庫一覧、ロット別在庫、QR 単位在庫画面を追加する。
