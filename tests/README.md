# テスト

出荷検品システムのテスト一式。前提として docker スタックが起動していること
(`docker compose up -d`、web が http://localhost:8080)。

## 種類

| 種別 | パス | 依存 | 実行環境 |
|------|------|------|----------|
| スモーク(HTTP) | `tests/smoke/smoke.sh` | curl のみ | どこでも |
| API コントラクト | `tests/api/contract.test.js` | Node 18+ (node:test 内蔵) | どこでも |
| コンソール検査 | `tests/smoke/console-check.js` | playwright + ブラウザ | ブラウザ有り |
| E2E | `tests/e2e/inspection.spec.js` | @playwright/test + ブラウザ | ブラウザ有り |

## 実行方法

### スモーク(最速の回帰ガード)

```bash
BASE=http://localhost:8080 bash tests/smoke/smoke.sh
```

本番17ページ=200、退避ページ=404、危険EP=403、分離ルーター疎通を確認。

### API コントラクト(推奨・外部依存なし)

```bash
BASE=http://localhost:8080 node --test tests/api/contract.test.js
```

分割ルーター(products/inspectors/reports/qc-tools/monitoring/system-config ほか)の
ステータスと形状、system-config の共有状態、危険EPの 403、404 ハンドラを検証。

### E2E(ブラウザ)

WSL サンドボックスにはブラウザのシステムライブラリ(libnspr4 等)が無く実行できない。
ブラウザが使えるローカル/CI では以下で実行する:

```bash
npm i -D @playwright/test
npx playwright install --with-deps chromium
BASE=http://localhost:8080 npx playwright test tests/e2e
```

検証内容: トップのコンソールエラーゼロ、layout.js のヘッダー注入、テーマ切替、
外部CDNリクエストが発生しないこと(vendorローカル化)、マスタ画面のテーブル描画。

## CI 組み込み(将来)

最小構成として、CI で `docker compose up -d` → スモーク + API コントラクトを
必須ゲートにするのが低コストで効果が高い。E2E はブラウザ付きジョブで追加する。

## 注意: レートリミッター

API は 15分あたり100リクエストのレート制限がある。スモークとコントラクトを
連続実行すると合計リクエスト数が上限を超え 429 になることがある(コード不具合ではない)。
その場合は `docker compose restart api`(インメモリのカウンタをリセット)してから
片方ずつ実行する。CI では test 環境のみ上限を緩和するのが望ましい。
