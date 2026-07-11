# Phase 1 在庫・ロット・QR 共通基盤 実装計画

作成日: 2026-07-08

## 目的

出荷検品で利用しているロット、QR、スキャン、監査ログの仕組みを、入庫、発注、受注、棚卸、製造指図にも使える共通在庫基盤へ拡張する。

この Phase 1 は `docs/business-expansion-roadmap.md` の最初の実装対象である。

ドキュメント方針は `docs/documentation-policy.md` に従う。構成図、データフロー図、画面遷移図が必要な説明資料は HTML First で別途作成する。

## 現状

現在の在庫関連テーブルは大きく 2 系統に分かれている。

| 系統 | テーブル | 用途 |
|------|----------|------|
| 簡易在庫 | `inventory` | 製品別の現在庫、引当、保管場所 |
| 出荷検品ロット | `lot_inventory` | PPS / QR 検品で使うロット別在庫 |
| QR 個体 | `qr_units` | QR 個体 ID とロットの紐付け |
| 出荷引当 | `shipping_lot_allocations` | 出荷指示明細ごとのロット引当 |
| 出荷スキャン | `picking_records` | QR / ロットのスキャン実績 |
| 出荷監査 | `shipping_audit_events` | 出荷業務イベント |

課題:

- `inventory` と `lot_inventory` が分離しており、どちらを正とするか曖昧。
- 在庫増減の履歴が追記型で統一されていない。
- 入庫、棚卸、製造消費に使える共通 `inventory_transactions` がない。
- 出荷以外の業務イベントを記録する共通 `operation_events` がない。
- 保管場所が文字列であり、保管場所マスタとして扱えていない。

## 方針

1. 既存の `lot_inventory` はすぐに廃止しない。
2. 新規の在庫増減は `inventory_transactions` に追記する。
3. 現在庫は `inventory_balances` に集計する。
4. `lot_inventory` は当面、出荷検品互換のロット在庫として維持する。
5. `qr_units` は全業務共通の QR 管理単位として拡張する。
6. 出荷検品の `shipping_audit_events` は維持し、新規業務は `operation_events` に記録する。
7. Grafana Cloud 用メトリクスは `shipping_audit_events` と `operation_events` の両方から集約する。

## 追加テーブル案

### `locations`

保管場所マスタ。

```sql
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    location_code VARCHAR(50) UNIQUE NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    area_name VARCHAR(100),
    location_type VARCHAR(50) DEFAULT 'warehouse',
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `inventory_transactions`

在庫変動履歴。原則として更新しない。

```sql
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id SERIAL PRIMARY KEY,
    transaction_type VARCHAR(50) NOT NULL,
    transaction_status VARCHAR(30) NOT NULL DEFAULT 'posted',
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    quantity_delta INTEGER NOT NULL,
    quantity_after INTEGER,
    source_type VARCHAR(80),
    source_id INTEGER,
    source_line_id INTEGER,
    reason_code VARCHAR(80),
    comment TEXT,
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

想定 `transaction_type`:

```text
initial_balance
receiving
shipping_allocation
shipping_cancel
shipping_complete
inventory_move_out
inventory_move_in
inventory_adjustment
inventory_count_adjustment
manufacturing_consumption
manufacturing_completion
hold
release_hold
defective
```

### `inventory_balances`

品目、ロット、QR、保管場所、ステータス別の現在庫。

```sql
CREATE TABLE IF NOT EXISTS inventory_balances (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    location_code VARCHAR(50),
    inventory_status VARCHAR(30) NOT NULL DEFAULT 'available',
    quantity INTEGER NOT NULL DEFAULT 0,
    last_transaction_id INTEGER REFERENCES inventory_transactions(id) ON DELETE SET NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, lot_number, qr_unit_id, location_code, inventory_status)
);
```

想定 `inventory_status`:

```text
available
allocated
inspection
on_hold
defective
consumed
shipped
lost
adjusted
```

### `operation_events`

出荷以外も含む共通業務イベント。

```sql
CREATE TABLE IF NOT EXISTS operation_events (
    id SERIAL PRIMARY KEY,
    event_domain VARCHAR(50) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    event_status VARCHAR(30) NOT NULL DEFAULT 'success',
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    lot_inventory_id INTEGER REFERENCES lot_inventory(id) ON DELETE SET NULL,
    qr_unit_id INTEGER REFERENCES qr_units(id) ON DELETE SET NULL,
    lot_number VARCHAR(50),
    qr_code VARCHAR(255),
    quantity INTEGER,
    source_type VARCHAR(80),
    source_id INTEGER,
    source_line_id INTEGER,
    before_data JSONB,
    after_data JSONB,
    reason_code VARCHAR(80),
    comment TEXT,
    user_id VARCHAR(255),
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

想定 `event_domain`:

```text
shipping
receiving
inventory
purchase
sales
manufacturing
cycle_count
ocr
system
```

## 既存テーブルへの追加案

### `lot_inventory`

既存互換を保つため、破壊的変更はしない。

追加候補:

```sql
ALTER TABLE lot_inventory ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE lot_inventory ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(30) DEFAULT 'available';
```

### `qr_units`

QR 管理単位を全業務で使うため、状態と所在を少し広げる。

追加候補:

```sql
ALTER TABLE qr_units ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE qr_units ADD COLUMN IF NOT EXISTS current_quantity INTEGER;
ALTER TABLE qr_units ADD COLUMN IF NOT EXISTS last_transaction_id INTEGER;
```

## 互換移行方針

### Step 1: 保管場所初期化

`lot_inventory.location` と `inventory.location` から `locations` を作る。

```text
lot_inventory.location = 'A-1-01'
  -> locations.location_code = 'A-1-01'
```

### Step 2: 初期在庫トランザクション作成

既存 `lot_inventory` から `inventory_transactions` に `initial_balance` を作る。

```text
lot_inventory.quantity = 80
  -> inventory_transactions.quantity_delta = 80
  -> inventory_balances.quantity = 80
```

### Step 3: 出荷検品との接続

既存の出荷ロット引当は現在 `shipping_lot_allocations` 作成時に `lot_inventory.quantity` を減らしている。

Phase 1 では、互換挙動を保ちつつ次のイベントを追加する。

| 操作 | transaction_type |
|------|------------------|
| ロット引当確定 | `shipping_allocation` |
| ロット引当取消 | `shipping_cancel` |
| 出荷完了 | `shipping_complete` |
| 完了後修正 | `inventory_adjustment` |

### Step 4: 集計再作成スクリプト

POC では、まず `inventory_balances` を再作成するローカルスクリプトを用意する。

```bash
./scripts/rebuild-inventory-balances.sh
```

将来は API トランザクション内で `inventory_balances` を更新する。

## API 設計

### 読み取り

```text
GET /api/inventory/balances
GET /api/inventory/balances?product_id=1
GET /api/inventory/balances?lot_number=REVIEW-P1-L1
GET /api/inventory/balances?location_code=R-1-01
GET /api/inventory/transactions
GET /api/inventory/transactions?product_id=1
GET /api/inventory/transactions?source_type=shipping_instruction
GET /api/qr-units/:qrCode
```

### 更新

```text
POST /api/inventory-moves
POST /api/inventory-adjustments
POST /api/inventory/rebuild-balances
```

POC では `POST /api/inventory/rebuild-balances` は管理用またはローカル限定とし、通常画面からは呼ばない。

## 画面設計

### 在庫一覧

表示項目:

- 品目コード
- 品目名
- ロット番号
- QR コード
- 保管場所
- 在庫ステータス
- 数量
- 最終更新日時

### 在庫変動履歴

表示項目:

- 発生日時
- 変動種別
- 品目
- ロット
- QR
- 保管場所
- 数量増減
- 参照伝票
- 理由
- 操作ユーザー

### QR 単位在庫

表示項目:

- QR コード
- 品目
- ロット
- 数量
- 保管場所
- ステータス
- 最終スキャン日時

## テスト方針

### DB テスト

- `locations` が既存 location 文字列から作成される。
- `inventory_transactions` に初期在庫が作成される。
- `inventory_balances` の合計が `lot_inventory.quantity` と一致する。
- 同じ再作成スクリプトを複数回実行しても二重計上しない。

### API 契約テスト

- `GET /api/inventory/balances` が配列を返す。
- `GET /api/inventory/transactions` が配列を返す。
- `GET /api/qr-units/:qrCode` が QR とロット情報を返す。
- M365 必須環境では未認証時に `401` になる。

### 現場レビュー

- `REVIEW-MULTI-001` のロット引当が在庫履歴に現れる。
- QR OK / NG / duplicate が業務イベントとして追える。
- 出荷完了後の在庫状態を確認できる。

## 実装タスク

1. `postgres/migrations` に Phase 1 スキーマを追加する。完了: `postgres/migrations/20260708_inventory_foundation.sql`
2. `supabase-schema.sql` に同じスキーマを反映する。完了
3. `scripts/rebuild-inventory-balances.sh` を追加する。完了
4. `api/routes/inventory.js` に `/balances` と `/transactions` を追加する。完了
5. `api/routes/qr-units.js` を追加する。完了
6. `api/server.js` に `qr-units` ルートを追加する。完了
7. `tests/api/contract.test.js` に契約テストを追加する。完了
8. `docs/business-expansion-roadmap.md` に Phase 1 詳細文書への参照を追加する。完了
9. ローカル Docker でマイグレーション、再計算、API テストを実行する。

## リスクと注意点

| リスク | 対策 |
|--------|------|
| `lot_inventory.quantity` と `inventory_balances.quantity` がずれる | Phase 1 では再計算スクリプトを正とし、差異チェックを追加する |
| 出荷検品の既存挙動を壊す | 既存テーブルを破壊せず、追加テーブル方式にする |
| `inventory` と新在庫 API の名前が衝突する | 既存 `/api/inventory` は維持し、まず `/api/inventory/balances` を追加する |
| Supabase 反映漏れ | `postgres/migrations` と `supabase-schema.sql` の両方を更新する |
| 非ローカル DB への誤投入 | データ再構築スクリプトは既定でローカル Docker 対象にする |

## Phase 1 完了条件

- DB に `locations`、`inventory_transactions`、`inventory_balances`、`operation_events` が存在する。
- 既存 `lot_inventory` から初期在庫を作成できる。
- 在庫バランスを API で取得できる。
- 在庫変動履歴を API で取得できる。
- QR コードから品目、ロット、数量、保管場所を取得できる。
- 既存の出荷検品 API と現場レビュー用スクリプトが引き続き成功する。
