# テスト / CI 運用メモ

## 目的

出荷検品アプリの主要な回帰を、ローカル Docker と GitHub Actions で早期に検出する。

CI では次を確認する。

- API JavaScript の構文チェック
- API 単体テスト
- API 依存関係の `npm audit`
- Docker Compose による Web / API / PostgreSQL 起動
- 画面・静的資産・主要 API のスモークテスト
- API 契約テスト

## ローカル実行

```bash
npm --prefix api run check:syntax
npm --prefix api test
npm --prefix api run audit
docker compose up -d --build
BASE=http://localhost:8080 bash tests/smoke/smoke.sh
BASE=http://localhost:8080 node --test tests/api/contract.test.js
```

## 契約テストの注意

`tests/api/contract.test.js` は、実行中のアプリに対して HTTP 経由で検証する。

注意点:

- `BASE` は原則 `http://localhost:8080` を指定する。
- 本番または Azure 公開 URL を `BASE` に指定しない。
- 帳票出力イベントの契約テストは、ローカル DB の監査ログに `report_printed` を 1 件追加する。
- M365 認証必須環境では、更新系 API が `401` になることを確認して終了する。

## レート制限

本番の既定値は `100 requests / 15 minutes`。

ローカル Docker と CI では、スモークテストと契約テストを連続実行するため `RATE_LIMIT_MAX=1000` を設定している。

本番で変更する場合は、Container Apps の API コンテナ環境変数で次を調整する。

- `RATE_LIMIT_MAX`
- `RATE_LIMIT_WINDOW_MS`

## CI

GitHub Actions 定義:

- `.github/workflows/ci.yml`

CI は `main` / `master` への push と pull request で実行する。

Docker 起動直後のレースを避けるため、`/health` が成功するまで待ってからスモークテストを実行する。
