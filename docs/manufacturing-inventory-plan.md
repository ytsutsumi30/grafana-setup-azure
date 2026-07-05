# 製造業向け入庫・在庫・棚卸し機能 全体計画

この文書は、既存の出荷検品アプリを参考にして、製造業向けの入庫管理、在庫管理、ロット管理、QR コード管理、棚卸し、Grafana Cloud 監視を追加するための計画書です。

## 目的

現在の出荷検品アプリを拡張し、製造現場で利用できる POC 向けの在庫管理アプリを作成します。

対象とする一連の業務は以下です。

```text
入庫予定
  -> ロット作成
  -> QR ラベル発行
  -> QR スキャンによる入庫検品
  -> 在庫反映
  -> 在庫照会
  -> QR スキャンによる棚卸し
  -> 差異確認
  -> 承認後の在庫調整
  -> Grafana Cloud 監視
```

## 基本方針

- 既存の出荷検品アプリの構成を流用する。
- 構成は静的 Web UI、Node.js API、PostgreSQL/Supabase、Docker、Azure Container Apps を前提とする。
- 在庫は品目、ロット、保管場所、QR 管理単位で追跡する。
- 現在庫と在庫変動履歴を分けて管理する。
- 現場でスキャンする単位として QR コードを使う。
- QR コードには短い ID のみを持たせ、詳細情報は DB で管理する。
- 操作イベントを記録し、監査・トラブル調査・監視に利用する。
- Grafana Cloud 監視を POC の最初から計画に含める。

## 管理階層

在庫は以下の 3 層で管理します。

```text
品目
  -> ロット
  -> QR 管理単位
```

例:

```text
品目: PART-A
ロット: LOT-20260705-001
QR: QR-LOT-20260705-001-0001
QR: QR-LOT-20260705-001-0002
QR: QR-LOT-20260705-001-0003
```

QR 管理単位は、箱、パレット、袋、容器、個品など、現場で実際にスキャンする単位に合わせます。

## 対象範囲

### 入庫管理

- 入庫予定を登録する。
- 発注品、外注戻り品、製造完了品、返品品を受け入れる。
- 入庫時にロット番号を作成または登録する。
- 入庫数量と梱包単位に応じて QR ラベルを発行する。
- QR スキャンで入庫検品を行う。
- 合格数量を利用可能在庫へ反映する。
- 不合格または判断保留の数量を、不良在庫または保留在庫へ反映する。

### 在庫管理

- 品目別在庫を表示する。
- ロット別在庫を表示する。
- QR 単位在庫を表示する。
- 保管場所別在庫を表示する。
- ステータス別在庫を管理する。
- 入庫、移動、棚卸調整などの在庫変動履歴を追跡する。
- 保管場所移動を登録する。
- ロットまたは QR 単位の保留、不良、解除、調整を行う。

### 棚卸し

- 保管場所、品目、ロットを指定して棚卸計画を作成する。
- QR スキャンで現品をカウントする。
- スキャン済み、未スキャン、不明 QR を判定する。
- 理論在庫と実在庫を比較する。
- 差異を確認する。
- 承認後に在庫調整を反映する。

### 監視

- API 稼働状況を監視する。
- DB 接続状況を監視する。
- API レスポンス時間とエラーを監視する。
- QR スキャン件数、入庫完了件数、棚卸差異件数などの業務メトリクスを監視する。
- Grafana Cloud でダッシュボードとアラートを作成する。

## QR コード管理設計

QR コードの中身は、短く安定した識別子にします。

```text
QR-LOT-20260705-001-0001
```

QR コードに長い JSON を埋め込む設計は避けます。アプリは `qr_code` をキーに DB を検索し、品目、ロット、数量、保管場所、状態を取得します。

### QR ステータス

```text
created       QR 発行済み
received      入庫済み
inspection    検査中
available     利用可能
allocated     引当済み
moved         移動済み
consumed      製造使用済み
shipped       出荷済み
on_hold       保留
defective     不良
lost          紛失
adjusted      調整済み
```

### QR 管理単位の主な項目

```text
qr_units
- id
- qr_code
- item_id
- lot_id
- location_id
- quantity
- unit_type
- status
- received_at
- last_scanned_at
- created_at
- updated_at
```

## ロット管理設計

ロットは、品質管理、期限管理、トレーサビリティの中心となる単位です。

```text
lots
- id
- lot_no
- item_id
- supplier_lot_no
- manufacturing_date
- expiration_date
- received_date
- quality_status
- status
- created_at
- updated_at
```

### ロット品質ステータス

```text
pending_inspection  検査待ち
approved            承認済み
rejected            不合格
on_hold             保留
expired             期限切れ
```

### ロット単位の操作

- ロット照会
- ロット別在庫照会
- ロット配下の QR 一覧表示
- ロット保留
- ロット保留解除
- ロット不良登録
- 有効期限アラート
- ロットトレーサビリティ表示

## データモデル案

POC では以下のテーブルを追加します。

```text
items
  品目マスタ。

locations
  保管場所マスタ。

lots
  ロット情報と品質ステータス。

qr_units
  QR 管理単位。

inventory_balances
  品目、ロット、保管場所、ステータス別の現在庫。

inventory_transactions
  在庫変動履歴。原則として更新せず追記する。

receiving_orders
  入庫予定ヘッダ。

receiving_order_lines
  入庫予定明細。

receiving_results
  入庫実績。

receiving_inspections
  QR 単位またはロット単位の入庫検品結果。

inventory_moves
  保管場所移動履歴。

inventory_counts
  棚卸ヘッダ。

inventory_count_lines
  棚卸対象と理論数量。

inventory_count_scans
  棚卸時の QR スキャン履歴。

inventory_adjustments
  棚卸差異や手動補正による在庫調整。

operation_events
  監視、監査、トラブル調査用の業務イベント。
```

## 在庫ステータス

在庫数量は、単純な数量ではなくステータス別に管理します。

```text
available     利用可能在庫
allocated     引当済み在庫
inspection    検査中在庫
on_hold       保留在庫
defective     不良在庫
```

入庫直後は原則 `inspection` とし、検品合格後に `available` へ移します。不合格品は `defective`、判断保留品は `on_hold` に移します。

## API 設計案

既存アプリと同じく `/api` 配下に追加します。

### マスタ

```text
GET    /api/items
POST   /api/items
GET    /api/locations
POST   /api/locations
```

### ロット

```text
POST   /api/lots
GET    /api/lots
GET    /api/lots/:id
PATCH  /api/lots/:id/status
GET    /api/lots/:id/qr-units
GET    /api/lots/:id/traceability
```

### QR 管理単位

```text
POST   /api/qr-units
GET    /api/qr-units/:qrCode
POST   /api/qr-units/:qrCode/scan
PATCH  /api/qr-units/:qrCode/status
POST   /api/qr-units/print-batch
```

### 入庫

```text
GET    /api/receiving-orders
POST   /api/receiving-orders
GET    /api/receiving-orders/:id
POST   /api/receiving-results
POST   /api/receiving-inspections
POST   /api/receiving-inspections/:id/approve
POST   /api/receiving-inspections/:id/reject
```

### 在庫

```text
GET    /api/inventory
GET    /api/inventory/by-lot
GET    /api/inventory/by-location
GET    /api/inventory/by-qr
GET    /api/inventory/transactions
POST   /api/inventory-moves
POST   /api/inventory-adjustments
PATCH  /api/inventory-adjustments/:id/approve
```

### 棚卸し

```text
POST   /api/inventory-counts
GET    /api/inventory-counts
GET    /api/inventory-counts/:id
POST   /api/inventory-counts/:id/scans
GET    /api/inventory-counts/:id/differences
PATCH  /api/inventory-counts/:id/close
```

### 監視

```text
GET    /api/monitoring/health
GET    /api/monitoring/events
GET    /metrics
```

## 画面設計案

### ダッシュボード

- 本日の入庫件数
- 本日の QR スキャン件数
- 棚卸差異件数
- 保留ロット件数
- 期限間近ロット件数
- API/DB ヘルス状態

### 入庫

- 入庫予定一覧
- 入庫登録
- ロット登録
- QR ラベル発行
- QR スキャン入庫検品

### 在庫

- 在庫一覧
- ロット別在庫
- QR 単位在庫
- 保管場所別在庫
- 在庫変動履歴
- 保管場所移動

### 棚卸し

- 棚卸計画一覧
- 棚卸計画作成
- QR スキャン棚卸
- 棚卸進捗
- 差異確認
- 在庫調整承認

### ロットトレーサビリティ

- ロット詳細
- ロット配下の QR 一覧
- 入庫履歴
- 移動履歴
- 棚卸履歴
- 調整履歴

### 監視

- Grafana Cloud 接続状態
- API エラー
- DB 接続エラー
- QR スキャン件数
- 入庫完了件数
- 棚卸差異件数

## Grafana Cloud 監視計画

Grafana Cloud では、技術的なヘルス状態と業務上の異常を両方監視します。

### 技術メトリクス

```text
http_requests_total
http_request_duration_seconds
http_5xx_total
db_query_errors_total
db_connection_errors_total
container_restart_count
```

### 業務メトリクス

```text
qr_scans_total
qr_unknown_scans_total
receiving_completed_total
receiving_rejected_total
inventory_count_scans_total
inventory_count_differences_total
inventory_adjustments_total
lot_on_hold_total
lot_expiring_soon_total
defective_qr_units_total
```

### 業務イベント

`operation_events` に以下のようなイベントを記録します。

```text
qr_scanned
qr_unknown_scanned
receiving_completed
receiving_rejected
lot_created
lot_held
lot_released
inventory_moved
inventory_count_started
inventory_count_scanned
inventory_count_difference_detected
inventory_adjustment_approved
```

### Grafana Cloud 連携方式

POC では、まず Prometheus 形式の `/metrics` エンドポイントを API に追加する方式を推奨します。

```text
Node.js API
  -> /metrics
  -> Grafana Cloud
  -> Dashboard / Alert
```

本番寄りに拡張する場合は、OpenTelemetry と Grafana Alloy または OpenTelemetry Collector を利用します。

```text
Node.js API
  -> OpenTelemetry metrics/traces/logs
  -> Grafana Alloy または OpenTelemetry Collector
  -> Grafana Cloud
```

### アラート案

```text
API 5xx が 5 分間で 10 件以上
DB 接続失敗が 3 回連続
Container restart 発生
棚卸差異率が 5% 超過
保留ロットが 10 件以上
期限切れロットが 1 件以上
不明 QR スキャンが 10 件以上
入庫検品不合格率がしきい値を超過
```

## 全体アーキテクチャ

```text
Browser / iPhone / iPad
  -> QR scan
  -> Web UI
  -> Node.js API
  -> PostgreSQL / Supabase
  -> inventory_transactions / operation_events

Node.js API
  -> /metrics
  -> Grafana Cloud
  -> Dashboard / Alert
```

## 実装フェーズ

### Phase 1: 設計文書作成

- 業務フロー
- DB スキーマ
- API 一覧
- 画面フロー
- QR とロットの運用ルール
- Grafana Cloud 監視設計

### Phase 2: DB スキーマ追加

以下を追加します。

- `lots`
- `qr_units`
- `inventory_balances`
- `inventory_transactions`
- `receiving_orders`
- `receiving_order_lines`
- `receiving_results`
- `receiving_inspections`
- `inventory_counts`
- `inventory_count_lines`
- `inventory_count_scans`
- `inventory_adjustments`
- `operation_events`

### Phase 3: 入庫と QR 管理

- 入庫予定 API
- ロット作成
- QR 管理単位作成
- QR ラベル一括発行
- QR スキャン入庫検品
- 在庫変動履歴登録

### Phase 4: 在庫管理

- 在庫一覧
- ロット別在庫
- QR 単位在庫
- 保管場所別在庫
- 保管場所移動
- 在庫履歴

### Phase 5: 棚卸し

- 棚卸計画作成
- QR スキャン棚卸
- 未スキャン QR 検出
- 不明 QR 検出
- 差異計算
- 在庫調整承認

### Phase 6: Grafana Cloud 監視

- `/metrics` 追加
- 技術メトリクス追加
- 業務メトリクス追加
- `operation_events` 追加
- Grafana Cloud ダッシュボード作成
- アラート設定

### Phase 7: Azure/Supabase 反映

- Supabase schema 適用
- API/Web Docker イメージ作成
- Azure Container Apps へデプロイ
- M365 認証との共存確認
- Grafana Cloud 取り込み確認

## POC 完成条件

POC は以下を満たした時点で完成とします。

```text
QR ラベルを発行できる。
QR スキャンで入庫検品できる。
ロットを作成・検索できる。
品目、ロット、保管場所、QR 単位で在庫を確認できる。
在庫変動が追記型の履歴として記録される。
QR スキャンで棚卸しできる。
未スキャン QR と不明 QR を検出できる。
棚卸差異を確認できる。
承認済み差異が在庫へ反映される。
Grafana Cloud で API ヘルスと業務メトリクスを確認できる。
Grafana Cloud で主要な障害・業務リスクのアラートを設定できる。
```

## 後回しにする項目

- ERP 連携
- 原価計算
- 高度な棚番最適化
- 複数拠点間移動の承認ワークフロー
- 本格的な WMS ピッキング最適化
- 製造実績・部品消費との連携
- ラベルプリンタ機種ごとの専用連携
