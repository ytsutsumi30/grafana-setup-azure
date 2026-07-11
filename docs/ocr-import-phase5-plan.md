# Phase 5: OCR 取込 設計

## 目的

既存の OCR 抽出機能を、受注・発注・入庫業務へ接続する。POC では OCR エンジンの精度向上よりも、読み取ったテキストを業務候補として保存し、人が確認して登録できる流れを優先する。

## 対象範囲

- 注文書 OCR から受注候補を作成する。
- 納品書 OCR から発注・入庫照合候補を作成する。
- OCR 原文、正規化テキスト、抽出ヘッダ、明細、照合候補を保存する。
- 受注候補から `sales_orders` と `sales_order_lines` を作成する。

## 追加テーブル

- `ocr_documents`
  - OCR 文書ヘッダ。文書番号、文書種別、原文、正規化テキスト、抽出結果、変換先を保持する。
- `ocr_document_lines`
  - OCR 明細。品目コード、品名、数量、単価、照合済み品目を保持する。
- `ocr_business_matches`
  - 業務照合候補。納品書明細と発注明細などの候補を保持する。

## API

- `GET /api/ocr-imports`
  - OCR 取込文書一覧を返す。
- `GET /api/ocr-imports/:id`
  - OCR 文書、明細、照合候補を返す。
- `POST /api/ocr-imports`
  - OCR テキストを登録し、ヘッダと明細を抽出する。
- `POST /api/ocr-imports/:id/create-sales-order`
  - 注文書 OCR から受注を作成する。

## 文字抽出ルール

POC では以下のようなテキストを想定する。

```text
注文番号: OCR-SO-001
顧客名: POC 顧客
希望出荷日: 2026-07-20
PROD001 製品A 2
PROD002 製品B 1
```

明細は `品目コード 品名 数量 [単価]` の順で抽出する。

## 納品書照合

納品書 OCR の明細は、品目コードが既存 `products.product_code` と一致する場合に、未入庫の `purchase_order_lines` と照合候補を作成する。

照合候補は自動確定しない。実運用では人が確認して入庫予定または入庫実績へ反映する。

## 制約

- OCR 精度そのものは既存 OCR API に依存する。
- GCP Document AI 連携は後回しのまま維持する。
- 明細抽出は POC ルールベースであり、注文書フォーマットが増えたらテンプレート化する。
