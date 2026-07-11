# 出荷検品アプリ 現場レビュー Runbook

作成日: 2026-07-08

## 目的

現場レビュー当日に、ローカル検証、Azure POC 確認、画面操作レビューを同じ順序で進める。

詳細な観点は次の文書を参照する。

- `docs/field-review-checklist.md`
- `docs/field-review-scenario.md`
- `docs/field-review-demo-data.md`

## 対象 URL

Azure POC:

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io/index.html
```

ローカル:

```text
http://localhost:8080
```

## 1. ローカル環境起動

```bash
cd ~/grafana-setup-azure
docker compose up -d --build
```

確認:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/health
curl http://localhost:8080/api/db-test
```

## 2. レビュー用データ準備

未着手状態へ戻す:

```bash
./scripts/reset-field-review-data.sh
```

データがない、または作り直す場合:

```bash
./scripts/seed-field-review-data.sh
```

DB 要約確認:

```bash
./scripts/check-field-review-data.sh
```

API 形状確認:

```bash
./scripts/check-field-review-api.sh
```

期待値:

| 項目 | 期待値 |
|------|--------|
| 出荷指示番号 | `REVIEW-MULTI-001` |
| ステータス | `pending` |
| 明細数 | 2 |
| ロット引当数 | 3 |
| 引当数量 | 25 |
| スキャン履歴 | 0 |
| 監査ログ | 0 |

## 3. API 通しリハーサル

画面レビュー前に API の代表フローを確認する。

```bash
./scripts/run-field-review-api-scenario.sh
```

確認される内容:

- PPS 作成
- QR OK
- QR 重複警告
- 未引当ロット NG
- ピッキング完了
- 梱包完了
- 出荷完了
- 帳票イベント登録
- 履歴、監査ログ確認

通し実行後は出荷指示が `shipped` になる。画面レビューを未着手状態からやり直す場合:

```bash
./scripts/reset-field-review-data.sh
./scripts/check-field-review-api.sh
```

## 4. 画面レビュー

対象出荷指示:

```text
REVIEW-MULTI-001
```

利用する QR:

| 用途 | QR |
|------|----|
| PROD001 / ロット1 OK | `QR-REVIEW-P1-L1-A` |
| PROD001 / ロット2 OK | `QR-REVIEW-P1-L2-A` |
| PROD002 / ロット1 OK | `QR-REVIEW-P2-L1-A` |
| 未引当ロット NG | `QR-REVIEW-NG-P2` |

操作順:

1. `/index.html` を開く。
2. M365 ログインを確認する。
3. `/shipping-instructions.html` で `REVIEW-MULTI-001` を選択する。
4. `/pps.html?id=<出荷指示ID>` へ進む。
5. 品目別、ロット別の引当数量を確認する。
6. PPS を開始する。
7. QR OK、重複、NG を確認する。
8. 全数量 OK 後、ピッキング完了、梱包完了、出荷完了を確認する。
9. `/shipping-history.html?id=<出荷指示ID>` で履歴と監査ログを確認する。
10. `/shipping-report.html` で出荷検品結果票とロット別出荷実績票を確認する。

## 5. Azure POC 確認

Azure POC は M365 認証が有効なため、画面操作を基本とする。

未認証 API の確認:

```bash
WEB_URL="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io"
curl -i "$WEB_URL/api/shipping-instructions"
```

期待値:

```text
HTTP 401
```

M365 アクセストークンがある場合のみ、API 確認スクリプトを使う。

```bash
BASE="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io" \
AUTH_TOKEN="<M365 access token>" \
./scripts/check-field-review-api.sh
```

注意:

- `run-field-review-api-scenario.sh` はデータを変更するため、Azure POC には原則実行しない。
- 非ローカル環境への通し実行は `ALLOW_NON_LOCAL=true` が必要。
- Azure POC でレビュー用データを投入する場合は、参加者へ事前共有する。

## 6. 記録する結果

| 項目 | 記録 |
|------|------|
| レビュー日 |  |
| 参加者 |  |
| 対象環境 | ローカル / Azure POC |
| 出荷指示 ID |  |
| PPS 開始結果 | OK / NG |
| QR OK 結果 | OK / NG |
| QR 重複結果 | OK / NG |
| QR NG 結果 | OK / NG |
| 出荷完了結果 | OK / NG |
| 履歴表示結果 | OK / NG |
| 帳票表示結果 | OK / NG |
| 監査ログ確認結果 | OK / NG |

レビュー証跡をローカルに保存する:

```bash
./scripts/collect-field-review-evidence.sh
```

出力先:

```text
review-evidence/<YYYYMMDD-HHMMSS>/
```

`review-evidence/` はローカル証跡置き場で、Git 管理対象外とする。レビュー後に共有する場合は、必要なフォルダだけを別途提出する。

主な出力:

| ファイル | 内容 |
|----------|------|
| `metadata.txt` | 実行日時、対象 URL、Git 情報 |
| `db-summary.txt` | DB 要約 |
| `api-summary.txt` | API 要約 |
| `review-records.tsv` | 出荷指示、明細、引当、スキャン、監査ログ |
| `api.log` | API コンテナログ |
| `web.log` | Web コンテナログ |
| `postgres.log` | PostgreSQL コンテナログ |

## 7. レビュー後の整理

ローカルを次回レビュー可能な状態へ戻す:

```bash
./scripts/reset-field-review-data.sh
```

ログ確認:

```bash
docker compose logs --tail=200 api
docker compose logs --tail=200 web
```

停止する場合:

```bash
docker compose down
```
