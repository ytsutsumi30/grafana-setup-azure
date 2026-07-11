# 製造業向け受発注・製造指図機能 全体計画

この文書は、既存の出荷検品アプリおよび入庫・在庫・棚卸し計画(docs/manufacturing-inventory-plan.md)を前提に、受注管理、発注・購買管理、製造指図・工程実績を追加するための計画書です。

## 目的

現在のアプリ群に業務の起点となる受発注機能と、製造工程の実績収集機能を追加し、以下の 2 本の業務フローを閉じます。

```text
受注フロー:
受注登録 (手入力 / OCR 取込)
  -> 受注残管理
  -> 出荷指示生成
  -> 出荷検品 (既存)
  -> 出荷実績反映

発注フロー:
発注登録
  -> 発注残管理
  -> 入庫予定生成 (在庫計画の receiving_orders)
  -> QR スキャン入庫検品 (在庫計画)
  -> 納品書 OCR 照合
  -> 在庫反映

製造フロー:
製造指図発行
  -> 工程別 QR 打刻 (開始 / 完了)
  -> 部品消費 (BOM 展開)
  -> 製品ロット作成
  -> 完成品入庫
  -> ロットトレーサビリティ
```

## 基本方針

- 既存の出荷検品アプリの構成を流用する。静的 Web UI、Node.js API、PostgreSQL/Supabase、Docker、Azure Container Apps を前提とする。
- 在庫計画(manufacturing-inventory-plan.md)のテーブル群(items、lots、qr_units、receiving_orders、inventory_transactions、operation_events)と整合させる。
- 受注は出荷指示の、発注は入庫予定の上流として位置づけ、下流ドキュメントへの参照キーを持たせる。
- OCR は既存の OCR 資産(AWS Textract / Document AI ルート)を流用し、注文書取込と納品書照合に横展開する。
- 工程実績の打刻は既存 QR 検品 UI のスキャン操作を流用する。
- 操作イベントは operation_events に記録し、Grafana Cloud 監視に載せる。
- POC では承認ワークフローを簡略化し、ステータス遷移のみで表現する。

## ドキュメント連鎖

各伝票は以下のように連鎖し、番号で追跡できるようにします。

```text
受注: sales_orders
  -> 出荷指示: shipping_instructions (既存)
  -> QR 検品: qr_inspections (既存)

発注: purchase_orders
  -> 入庫予定: receiving_orders (在庫計画)
  -> 入庫検品: receiving_inspections (在庫計画)

製造指図: work_orders
  -> 部品消費: inventory_transactions (在庫計画)
  -> 製品ロット: lots (在庫計画)
```

## 対象範囲

### 受注管理

- 得意先マスタを管理する。
- 受注を登録する(手入力)。
- FAX/PDF 注文書を OCR で取り込み、確認・修正のうえ受注化する。
- 受注一覧、受注残(未出荷数量)を照会する。
- 受注明細から出荷指示を生成する。
- 納期回答(回答納期の登録)を行う。
- 受注のキャンセル・数量変更を履歴付きで行う。

### 発注・購買管理

- 仕入先マスタを管理する。
- 発注を登録する。
- 発注一覧、発注残(未入庫数量)を照会する。
- 発注明細から入庫予定(receiving_orders)を生成する。
- 納品書を OCR で読み取り、発注データと自動突合する。
- 分納・過納・欠品を検出し、差異を記録する。

### 製造指図・工程実績

- 工程マスタを管理する。
- 製造指図を発行する(品目、数量、納期、使用 BOM)。
- 製造指図票に QR コードを印字する。
- 工程ごとに QR 打刻で開始・完了・数量・作業者を記録する。
- BOM(既存 product_components)を展開し、部品所要を算出する。
- 部品消費を QR 単位で記録し、在庫変動履歴(inventory_transactions)へ反映する。
- 完成品に製品ロットを採番し、完成品入庫につなげる。
- 指図別の進捗(未着手・仕掛・完了)を照会する。

### トレーサビリティ

- 製品ロットから使用部品ロットへの逆展開(どの材料を使ったか)。
- 部品ロットから出荷先への正展開(どこへ出荷されたか)。
- 受注番号・発注番号・製造指図番号を横断した履歴表示。

## OCR 取込設計

OCR は「読み取り結果をそのまま登録しない」ことを原則とし、必ず確認画面を挟みます。

```text
注文書 PDF / 画像
  -> OCR (既存 Textract / Document AI ルート)
  -> ocr_documents に原本と解析結果を保存
  -> 確認・修正画面 (候補表示、得意先/品目のマスタ照合)
  -> 受注登録
```

納品書照合も同じ流れで、突合先が発注明細になります。

```text
納品書
  -> OCR
  -> 発注明細と自動突合 (発注番号、品目、数量)
  -> 差異表示 (数量差異、単価差異、未発注品)
  -> 入庫予定への引き当て
```

### OCR ドキュメントの主な項目

```text
ocr_documents
- id
- document_type      order_sheet / delivery_note
- source_filename
- storage_path
- ocr_engine
- raw_result         JSONB
- parsed_result      JSONB
- match_status       unmatched / partially_matched / matched
- confirmed_by
- confirmed_at
- linked_order_id    受注または発注への参照
- created_at
```

## ステータス設計

### 受注ステータス

```text
draft         下書き (OCR 取込直後など)
confirmed     受注確定
allocated     引当済み
partially_shipped  一部出荷
shipped       出荷完了
cancelled     キャンセル
```

### 発注ステータス

```text
draft         下書き
ordered       発注済み
partially_received  一部入庫
received      入庫完了
closed        検収完了
cancelled     キャンセル
```

### 製造指図ステータス

```text
planned       計画済み
released      発行済み
in_progress   仕掛中
completed     完成
closed        実績確定
cancelled     中止
```

### 工程実績ステータス

```text
pending       未着手
started       着手
completed     完了
suspended     中断
```

## データモデル案

POC では以下のテーブルを追加します。

```text
customers
  得意先マスタ。

suppliers
  仕入先マスタ。

sales_orders
  受注ヘッダ。得意先、受注日、希望納期、回答納期、ステータス。

sales_order_lines
  受注明細。品目、数量、単価、出荷済数量、shipping_instruction_id 参照。

purchase_orders
  発注ヘッダ。仕入先、発注日、納期、ステータス。

purchase_order_lines
  発注明細。品目、数量、単価、入庫済数量、receiving_order_line_id 参照。

ocr_documents
  OCR 取込した注文書・納品書の原本情報と解析結果。

delivery_note_matches
  納品書 OCR と発注明細の突合結果および差異。

processes
  工程マスタ。工程コード、工程名、標準時間。

work_orders
  製造指図ヘッダ。品目、指図数量、納期、製品ロット参照、ステータス。

work_order_operations
  指図別工程明細。工程順、計画数量、実績数量、ステータス。

work_order_components
  指図別部品所要。BOM (product_components) 展開結果と消費済数量。

operation_results
  工程実績。QR 打刻による開始・完了・数量・作業者・打刻時刻。

material_consumptions
  部品消費実績。qr_units / lots への参照を持ち、inventory_transactions と対応。
```

### 主なリレーション

```text
customers 1-n sales_orders 1-n sales_order_lines
sales_order_lines 1-n shipping_instructions (既存)

suppliers 1-n purchase_orders 1-n purchase_order_lines
purchase_order_lines 1-n receiving_order_lines (在庫計画)

work_orders 1-n work_order_operations 1-n operation_results
work_orders 1-n work_order_components 1-n material_consumptions
work_orders n-1 products (既存) / 1-1 lots (製品ロット、在庫計画)
```

## API 設計案

既存アプリと同じく `/api` 配下に追加します。

### マスタ

```text
GET    /api/customers
POST   /api/customers
PUT    /api/customers/:id
GET    /api/suppliers
POST   /api/suppliers
PUT    /api/suppliers/:id
GET    /api/processes
POST   /api/processes
```

### 受注

```text
GET    /api/sales-orders
POST   /api/sales-orders
GET    /api/sales-orders/:id
PUT    /api/sales-orders/:id
PATCH  /api/sales-orders/:id/status
GET    /api/sales-orders/backlog
POST   /api/sales-orders/:id/create-shipping-instructions
PATCH  /api/sales-order-lines/:id/answer-date
```

### OCR 取込

```text
POST   /api/ocr-documents            アップロードと OCR 実行
GET    /api/ocr-documents
GET    /api/ocr-documents/:id
PATCH  /api/ocr-documents/:id        確認・修正結果の保存
POST   /api/ocr-documents/:id/confirm-as-sales-order
POST   /api/ocr-documents/:id/match-delivery-note
```

### 発注

```text
GET    /api/purchase-orders
POST   /api/purchase-orders
GET    /api/purchase-orders/:id
PUT    /api/purchase-orders/:id
PATCH  /api/purchase-orders/:id/status
GET    /api/purchase-orders/backlog
POST   /api/purchase-orders/:id/create-receiving-order
GET    /api/delivery-note-matches/:purchaseOrderId
```

### 製造指図

```text
GET    /api/work-orders
POST   /api/work-orders
GET    /api/work-orders/:id
PATCH  /api/work-orders/:id/release
PATCH  /api/work-orders/:id/complete
GET    /api/work-orders/:id/operations
GET    /api/work-orders/:id/components
GET    /api/work-orders/:id/progress
```

### 工程実績 (QR 打刻)

```text
POST   /api/operation-results/scan          指図 QR + 工程 + 作業者で打刻
PATCH  /api/operation-results/:id/complete
POST   /api/material-consumptions/scan      部品 QR スキャンで消費登録
GET    /api/work-orders/:id/consumptions
```

### トレーサビリティ

```text
GET    /api/traceability/lot/:lotId/backward   製品ロット -> 使用部品ロット
GET    /api/traceability/lot/:lotId/forward    部品ロット -> 出荷先
GET    /api/traceability/order/:salesOrderId   受注起点の横断履歴
```

## 画面設計案

### ダッシュボード追加項目

- 本日の受注件数
- 受注残件数・金額
- 納期遅延リスク件数
- 発注残件数
- 納品書照合差異件数
- 仕掛中の製造指図件数
- 工程遅延件数

### 受注

- 受注一覧 (ステータス・得意先・納期で絞り込み)
- 受注登録・編集
- 注文書 OCR 取込・確認・修正
- 受注残照会
- 出荷指示生成

### 発注

- 発注一覧
- 発注登録・編集
- 発注残照会
- 入庫予定生成
- 納品書 OCR 照合・差異確認

### 製造

- 製造指図一覧・発行
- 指図詳細 (工程・部品所要・進捗)
- 工程実績打刻 (モバイル向け、QR スキャン)
- 部品消費スキャン (モバイル向け)
- 製造進捗ボード (工程 x 指図)

### トレーサビリティ

- ロット正展開・逆展開ツリー表示
- 受注番号・発注番号・指図番号での横断検索

## Grafana Cloud 監視計画

在庫計画の監視基盤 (/metrics、operation_events) に以下を追加します。

### 業務メトリクス

```text
sales_orders_created_total
sales_orders_ocr_imported_total
ocr_correction_fields_total       OCR 修正が発生した項目数
sales_order_backlog_count
sales_order_overdue_count
purchase_orders_created_total
purchase_order_backlog_count
delivery_note_mismatch_total
work_orders_released_total
work_orders_completed_total
work_order_delayed_count
operation_lead_time_seconds
material_consumption_mismatch_total
```

### 業務イベント

operation_events に以下を追加します。

```text
sales_order_created
sales_order_confirmed
ocr_document_imported
ocr_document_confirmed
shipping_instruction_generated
purchase_order_created
receiving_order_generated
delivery_note_matched
delivery_note_mismatch_detected
work_order_released
operation_started
operation_completed
material_consumed
work_order_completed
```

### アラート案

```text
納期超過の受注残が 1 件以上
納品書照合差異が 1 日 5 件以上
OCR 取込の修正率がしきい値を超過
工程遅延 (計画完了日超過) が発生
部品消費数量と理論数量の乖離がしきい値を超過
```

## 全体アーキテクチャ

```text
Browser / iPhone / iPad
  -> 注文書・納品書アップロード -> OCR (Textract / Document AI)
  -> QR scan (工程打刻・部品消費)
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

- 受注・発注・製造指図の業務フロー
- DB スキーマ詳細
- API 一覧
- 画面フロー
- OCR 取込・照合の運用ルール
- ステータス遷移図

### Phase 2: マスタと受注管理

- customers / suppliers / processes テーブル追加
- sales_orders / sales_order_lines 追加
- 受注 CRUD と受注残 API
- 受注一覧・登録画面
- 出荷指示生成 (既存 shipping_instructions 連携)

### Phase 3: 受注 OCR 取込

- ocr_documents テーブル追加
- 注文書 OCR 取込 API (既存 OCR ルート流用)
- 確認・修正画面とマスタ照合
- 受注化処理

### Phase 4: 発注・購買管理

- purchase_orders / purchase_order_lines 追加
- 発注 CRUD と発注残 API
- 入庫予定生成 (在庫計画 receiving_orders 連携)
- 納品書 OCR 照合と差異表示

### Phase 5: 製造指図・工程実績

- work_orders / work_order_operations / work_order_components 追加
- 指図発行と BOM 展開 (product_components 流用)
- 指図票 QR 印字
- 工程打刻 API・モバイル画面
- 部品消費スキャンと inventory_transactions 連携
- 製品ロット採番 (在庫計画 lots 連携)

### Phase 6: トレーサビリティ統合

- 正展開・逆展開 API
- 横断検索画面
- ツリー表示

### Phase 7: Grafana Cloud 監視

- 業務メトリクス追加
- operation_events イベント追加
- ダッシュボード・アラート設定

### Phase 8: Azure/Supabase 反映

- Supabase schema 適用
- API/Web Docker イメージ作成
- Azure Container Apps へデプロイ
- M365 認証との共存確認

## POC 完成条件

```text
得意先・仕入先・工程マスタを管理できる。
受注を手入力と OCR 取込の両方で登録できる。
OCR 取込は確認・修正画面を経由して受注化される。
受注残を照会でき、受注から出荷指示を生成できる。
発注を登録し、発注残を照会できる。
発注から入庫予定を生成できる。
納品書 OCR と発注明細の突合・差異検出ができる。
製造指図を発行し、BOM から部品所要を展開できる。
工程の開始・完了を QR 打刻で記録できる。
部品消費が QR スキャンで記録され、在庫履歴に反映される。
製品ロットから部品ロットへの逆展開ができる。
部品ロットから出荷先への正展開ができる。
Grafana Cloud で受注残・照合差異・工程遅延を確認できる。
```

## 後回しにする項目

- 検査成績書・不適合管理 (NCR)・是正処置 (CAPA)
- 設備点検・保全管理
- 納品書・現品票などの帳票 PDF 出力
- 簡易 MRP・所要量計算・在庫引当の自動化
- 原価計算・単価管理の高度化
- EDI・ERP 連携
- 承認ワークフロー (多段階承認)
- スケジューラ (小日程計画・負荷山積み)

