# 出荷検品アプリ 現場レビュー用デモデータ準備

作成日: 2026-07-08

## 目的

現場レビューで次のシナリオを一通り確認できるよう、必要なデータ条件と確認方法を整理する。

- 複数品目、複数ロットの出荷指示
- QR 検品 OK
- 未引当ロット、別品目、重複スキャン
- 出荷完了
- 完了後修正
- 帳票初版、再発行、修正版

この文書は、データを直接変更する前の確認手順として使う。

現場レビュー当日の実行順は `docs/field-review-runbook.md` を参照する。

## 対象環境

ローカル確認:

```bash
docker compose up -d --build
```

Azure POC 確認:

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

注意:

- Azure POC 環境でデータを追加、修正する場合は、レビュー参加者へ事前に共有する。
- 帳票出力イベント、完了後修正、QR 検品は監査ログに残る。
- 契約テストはローカル DB 前提で実行し、Azure 公開 URL に向けない。

## 必要なデータパターン

| No | パターン | 目的 |
|----|----------|------|
| 1 | 単一品目、単一ロットの出荷指示 | 既存互換の確認 |
| 2 | 複数品目、単一ロットの出荷指示 | 品目切替の確認 |
| 3 | 複数品目、複数ロットの出荷指示 | 主シナリオ確認 |
| 4 | 未引当ロット | NG 判定確認 |
| 5 | 別品目ロット | NG 判定確認 |
| 6 | 同一 QR / 同一ロットの再スキャン | 重複判定確認 |
| 7 | 出荷完了済みデータ | 履歴、帳票確認 |
| 8 | 完了後修正済みデータ | 修正版帳票、監査ログ確認 |

## 関連テーブル

| テーブル | 用途 |
|----------|------|
| `shipping_instructions` | 出荷指示ヘッダ |
| `shipping_instruction_lines` | 出荷指示内の品目明細 |
| `lot_inventory` | ロット在庫 |
| `shipping_lot_allocations` | 確定済みロット引当 |
| `picking_instructions` | PPS / ピッキング指示 |
| `picking_records` | QR / ロット検品記録 |
| `qr_units` | QR 個体 ID 管理 |
| `shipping_audit_events` | 業務イベント監査ログ |

## ローカル DB 確認コマンド

読み取り専用の要約チェック:

```bash
./scripts/check-field-review-data.sh
```

ローカル DB にレビュー用デモデータを投入:

```bash
./scripts/seed-field-review-data.sh
./scripts/check-field-review-data.sh
```

レビュー用データを未着手状態へ戻す:

```bash
./scripts/reset-field-review-data.sh
```

API レスポンス形状まで確認:

```bash
./scripts/check-field-review-api.sh
```

ローカルで PPS / QR 検品から出荷完了、帳票イベント、履歴確認まで API で通し実行:

```bash
./scripts/run-field-review-api-scenario.sh
```

この通し実行はローカル DB の `REVIEW-MULTI-001` を初期化してから、スキャン記録、梱包記録、出荷完了、帳票出力イベント、監査ログを作成する。Azure POC など非ローカル環境への実行は既定で拒否される。

通し実行後に画面レビューをやり直す場合は、次の順で戻す。

```bash
./scripts/reset-field-review-data.sh
./scripts/check-field-review-api.sh
```

投入される代表データ:

| 用途 | 値 |
|------|----|
| 出荷指示番号 | `REVIEW-MULTI-001` |
| OK 用 QR | `QR-REVIEW-P1-L1-A` |
| OK 用 QR | `QR-REVIEW-P1-L2-A` |
| OK 用 QR | `QR-REVIEW-P2-L1-A` |
| 別品目 NG 用 QR | `QR-REVIEW-NG-P2` |

`scripts/seed-field-review-data.sh` はローカル Docker DB を既定対象とする。`DB_URL` を指定した実行は誤投入防止のため拒否される。非ローカル DB へ投入する場合は、対象環境を確認したうえで `ALLOW_NON_LOCAL=true` を明示する。

ローカル Docker の PostgreSQL に接続:

```bash
docker compose exec postgres psql -U production_user -d production_db
```

出荷指示の確認:

```sql
SELECT id, instruction_id, customer_name, shipping_date, status, quantity
FROM shipping_instructions
ORDER BY id;
```

品目明細の確認:

```sql
SELECT l.id, l.shipping_instruction_id, si.instruction_id,
       p.product_code, p.product_name,
       l.quantity, l.shipped_quantity, l.status
FROM shipping_instruction_lines l
JOIN shipping_instructions si ON si.id = l.shipping_instruction_id
JOIN products p ON p.id = l.product_id
ORDER BY l.shipping_instruction_id, l.id;
```

ロット在庫の確認:

```sql
SELECT li.id, p.product_code, p.product_name,
       li.lot_number, li.quantity, li.location, li.status
FROM lot_inventory li
JOIN products p ON p.id = li.product_id
ORDER BY p.product_code, li.lot_number;
```

ロット引当の確認:

```sql
SELECT a.id, si.instruction_id, p.product_code,
       a.lot_number, a.shipped_quantity,
       a.status, a.scanned_at
FROM shipping_lot_allocations a
JOIN shipping_instruction_lines l ON l.id = a.shipping_instruction_line_id
JOIN shipping_instructions si ON si.id = l.shipping_instruction_id
JOIN products p ON p.id = a.product_id
ORDER BY si.id, p.product_code, a.lot_number;
```

監査ログの確認:

```sql
SELECT id, shipping_instruction_id, event_type, event_status,
       product_id, lot_number, qr_code, quantity,
       reason_code, comment, occurred_at
FROM shipping_audit_events
ORDER BY occurred_at DESC, id DESC
LIMIT 50;
```

## API での確認

ローカル:

```bash
BASE=http://localhost:8080
curl "$BASE/api/shipping-instructions"
curl "$BASE/api/shipping-instructions/1/pps-status"
curl "$BASE/api/shipping-instructions/1/history"
```

レビュー用デモデータを対象に、一覧、PPS 状態、履歴、出荷完了条件をまとめて確認する場合:

```bash
./scripts/check-field-review-api.sh
```

レビュー用デモデータを対象に、PPS / QR 検品から出荷完了までの代表 API フローを通し実行する場合:

```bash
./scripts/run-field-review-api-scenario.sh
```

Azure POC:

M365 ログイン後、ブラウザ画面から確認する。

未認証の `curl` では保護対象 API は `401` になる。

```bash
WEB_URL="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io"
curl -i "$WEB_URL/api/shipping-instructions/1/history"
```

Azure POC に対して API で確認する場合は、M365 のアクセストークンを指定する。

```bash
BASE="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io" \
AUTH_TOKEN="<M365 access token>" \
./scripts/check-field-review-api.sh
```

## データ準備の考え方

### 1. 正常出荷データ

必要条件:

- 1 出荷指示に 2 品目以上ある。
- 少なくとも 1 品目は 2 ロット以上に分けて引当できる。
- 各ロットに検品 OK 用の QR またはロット番号がある。

確認する画面:

- `/shipping-instructions.html`
- `/pps.html?id=<出荷指示ID>`
- `/shipping-history.html?id=<出荷指示ID>`

### 2. NG 検品データ

必要条件:

- 出荷指示に含まれないロット番号を用意する。
- 出荷指示に含まれない別品目のロット番号を用意する。
- QR 不明扱いにする入力値を用意する。

確認する期待結果:

- NG として記録される。
- 検品 OK 数量には加算されない。
- `shipping_audit_events` に NG または警告系イベントが残る。

### 3. 重複スキャンデータ

必要条件:

- 同じ QR または同じロット入力値を複数回スキャンする。

確認する期待結果:

- 2 回目以降は警告される。
- 検品 OK 数量に追加カウントされない。
- 監査ログに重複イベントが残る。

### 4. 完了後修正データ

必要条件:

- 出荷完了済みの出荷指示がある。
- ロット引当が存在する。
- 修正先ロットまたは修正数量を決めておく。

確認する期待結果:

- 理由入力が必須になる。
- 修正前後の差分が履歴画面に表示される。
- 帳票が修正版として表示される。

### 5. 帳票再発行データ

必要条件:

- 出荷完了済みの出荷指示がある。
- 出荷検品結果票またはロット別出荷実績票を複数回出力する。

確認する期待結果:

- 初回は `初版` または `修正版`。
- 2 回目以降は `再発行N` または `修正版・再発行N`。
- `shipping_audit_events.after_data.issue_number` が増える。

## レビュー前のデータ確認チェック

- [ ] レビュー対象の出荷指示 ID を決めた。
- [ ] 複数品目の出荷指示を確認した。
- [ ] 複数ロットの品目を確認した。
- [ ] OK 用 QR / ロット番号を確認した。
- [ ] NG 用 QR / ロット番号を確認した。
- [ ] 重複確認用 QR / ロット番号を確認した。
- [ ] 出荷完了済みデータを確認した。
- [ ] 完了後修正対象の引当 ID を確認した。
- [ ] 帳票再発行対象の出荷指示 ID を確認した。

## レビュー当日に記録する値

| 項目 | 値 |
|------|----|
| 正常出荷用 出荷指示 ID |  |
| NG 確認用 出荷指示 ID |  |
| 完了後修正用 出荷指示 ID |  |
| 帳票確認用 出荷指示 ID |  |
| OK 用 QR / ロット番号 |  |
| 未引当ロット番号 |  |
| 別品目ロット番号 |  |
| 重複確認用 QR / ロット番号 |  |
