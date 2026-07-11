---
name: playwright
description: ターミナルから実ブラウザを操作するとき(ページ遷移・フォーム入力・クリック・スクリーンショット・データ抽出・UI不具合の再現)。ローカル開発中アプリ(例 docker compose の web:8080)のスモーク/E2E検証・画面確認・ブラウザログ確認を含む。テストファイル(@playwright/test)の作成を明示されない限り playwright-cli を使う。curlで足りる単なるHTTP API確認には使わない。
---

# Playwright CLI(ブラウザ自動化・ローカルアプリ検証)

## DO(やること)

- 事前確認: `command -v npx` が無ければ Node.js/npm の導入を依頼して停止。
- ラッパー経由で実行(グローバルインストール不要):
  `export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"`(既定 `~/.codex/skills`。本リポジトリでは `.claude/skills/playwright/scripts/playwright_cli.sh` も可)
- 基本ループ: `"$PWCLI" open <URL>` → `snapshot` → 最新snapshotのref(e15等)で `click/fill/type/press` → 遷移・モーダル開閉・タブ切替後は再snapshot → 必要に応じ `screenshot` / `tracing-start|stop` / `tab-new|list|select`。
- ローカルアプリ検証: 先にサーバーを起動(例: `docker compose up -d` → web:8080)してから上記ループで検証。
- 視認が有効な場面では `--headed`。
- 詳細が必要なときだけ `references/cli.md`(コマンド一覧)/ `references/workflows.md`(実践例・トラブルシュート)を開く。

## DON'T(やらないこと)

- snapshotなしで要素refを推測しない。refが古びたら再snapshot。
- `eval` / `run-code` でrefを迂回しない(必要時のみ・理由を明記)。
- 明示要求がない限り @playwright/test のテストファイルを書かない。
- 成果物を新しいトップレベルフォルダに置かない(`output/playwright/` を使う)。

## OUTPUT FORMAT(出力の型)

- 実行したコマンド列(コピペ再実行可能な形)
- 検証結果: 期待 / 実際 / 判定(OK・NG)の箇条書き
- 取得した成果物のパス(screenshot / trace は `output/playwright/`)
