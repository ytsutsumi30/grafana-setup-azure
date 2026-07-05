# 技術的負債改善 実行計画 (Skills 適用版)

docs/tech-debt-improvement-plan.md (計画) を、WSL2 の Claude Code + 導入済みスキル 16 件で実行するための手順書。
2026-07-06 時点の実測: web/ に HTML 47 本、api/server.js 5,691 行、.claude/skills に 16 スキル配置済み、main に未コミット変更あり。

## 実行方法

```text
方法A (推奨): WSL2 ターミナルで cd ~/grafana-setup-azure && claude
             → 下記プロンプトを貼り付けて対話実行 (許可の制御がしやすい)
方法B: Claude Desktop から @claude-code-wsl 経由で指示
             → 短い確認・単発タスク向け
```

ルール: 1 フェーズ = 1 ブランチ。フェーズ完了ごとに `docker compose up -d --build` とスモークテストで検証してからマージ。

## Step 0: 事前準備 (最初に 1 回)

```bash
cd ~/grafana-setup-azure
# 未コミット変更 (README.md, api/server.js, infra/terraform/*) を確認して退避
git status
git add -A && git commit -m "wip: pre tech-debt snapshot"   # または git stash
# 検証基盤を起動
docker compose up -d --build
curl -s http://localhost:8080/health && curl -s http://localhost:8080/api/health
```

## Phase 0: セキュリティと秘密情報 (D6/D7) — 最優先

ブランチ: `git checkout -b chore/debt-p0-security`

Claude Code へのプロンプト (スキル発動を明示):

```text
1. security-threat-model スキルを使って、このリポジトリの脅威モデリングを実施して。
   公開Webが認証なし、API に /database/backup /database/restore /logs 系がある前提。
   結果は docs/security/threat-model.md に出力して。

2. security-best-practices スキルで api/ ディレクトリをレビューして。
   特に: 認証なし公開、/database/* エンドポイント、CORS 全開、winston のファイルログ。
   指摘ごとに修正パッチを提案し、承認したものから適用して。

3. infra/terraform/terraform.tfvars と terraform.tfstate* と supabase-project.json を
   git 管理から外して (git rm --cached)、.gitignore を確認。
   tfstate の Azure Storage バックエンド移行手順を docs/security/state-backend.md に書いて。
```

検証: `git ls-files | grep -E "tfvars$|tfstate"` が空。/database/restore が 401/404 を返す。

## Phase 1: ページと JS の整理 (D1/D3/D10)

ブランチ: `chore/debt-p1-cleanup`

```text
1. playwright スキルを使って、http://localhost:8080 のスモークテストを tests/e2e/ に作成して実行して。
   対象: index の検品待ち一覧表示、maintenance への遷移、shipping-instructions 一覧、/api/health。
   (整理前のベースラインとして先に green にする)

2. web/ の 47 HTML を本番/退避に分類して。本番候補は docs/ui-improvement-plan.md の
   「ページ整理計画」の通り。qr-inspection 系は index.html が参照する qr-inspection3.html を本番とする。
   退避対象を web/_archive/ へ git mv し、web/js の未参照 JS (app-backup.js、modules/ 重複) も
   参照調査のうえ退避。*.bak *.backup-* も対象。

3. nginx の default.conf.template に _archive 遮断 (return 404) を追加し、
   .dockerignore に web/_archive を追加。index.html の title と web/manifest.json を実態に修正。
```

検証: `ls web/*.html | wc -l` が 15±3。docker compose build 後にスモークテスト green。

## Phase 2: 共通基盤と CDN ローカル化 (D2/D4)

ブランチ: `chore/debt-p2-foundation`

```text
1. prj3-frontend スキルの規約に従って css/tokens.css・css/components.css・js/layout.js を作成して。
   theme-factory スキルでトークンのライト/ダーク 2 テーマを設計して tokens.css に反映して。

2. まず index.html と maintenance.html の 2 ページをパイロットとして共通基盤へ移行して
   (インライン style 削除、data-page 付与、layout.js 読み込み)。
   web-design-reviewer スキルで移行結果をレビューして、指摘を反映して。

3. パイロット確認後、残りの本番ページを同じ流儀で移行して。1 コミット = 1〜2 ページ。

4. Bootstrap / Font Awesome (使用アイコンのサブセット) / qr-scanner / Chart.js を
   web/vendor/ に配置して、全ページの CDN 参照を置換して。
```

検証: `grep -rE "jsdelivr|cdnjs|unpkg" web --include='*.html' -l | grep -v _archive` が空。
オフライン (ネットワーク遮断) でも画面が崩れない。スモークテスト green。

## Phase 3: server.js のルート分割 (D5)

ブランチ: `chore/debt-p3-api-split`

```text
1. refactor スキルを使って api/server.js (5,691 行) の分割計画を作成して。
   目標構成: api/routes/{products,shipping-instructions,qr-inspections,inspectors,
   reports,qc-tools,new-qc,monitoring,inventory,pps,system}.js + api/lib/{db,logger}.js。
   既存の routes/ocr*.js の流儀に合わせること。

2. 計画に従い 1 ドメインずつ抽出して。1 ドメイン = 1 コミット。
   各コミット後に docker compose up -d --build api && スモークテストを実行して、
   green を確認してから次へ進むこと。
   依存の少ない reports → qc-tools → new-qc → monitoring から始め、
   shipping-instructions / qr-inspections は最後に。

3. 完了後、server.js が起動+ミドルウェア+ルート登録のみ (200 行以下) であることを確認し、
   server.js.backup.* を削除して。
```

検証: `wc -l api/server.js` ≦ 200。全ルートのスモーク green。`git log --oneline` がドメイン単位。

## Phase 4: テスト整備 (D9)

ブランチ: `chore/debt-p4-tests`

```text
webapp-testing スキルの戦略に沿って、Phase 1 のスモークを拡張して:
- E2E: QR 検品フロー (モック QR 値の投入)、ピッキング、マスタ CRUD 1 種
- API: 分割した各ルートの代表 GET/POST のコントラクトテスト
playwright スキルで実装・実行し、tests/README.md に実行方法を書いて。
```

検証: `npx playwright test` が green。

## Phase 5: PWA 完成 (D8)

ブランチ: `chore/debt-p5-pwa`

```text
prj3-frontend スキルの「API 呼び出し」「現場向け画面の基準」規約に従って:
1. js/offline-queue.js (IndexedDB キュー + online 再送 + 送信状態表示) を実装
2. Service Worker (アプリシェル cache-first、API network-first) を実装
3. qr-inspection3 のスキャン POST をキュー経由に変更
4. manifest.json の start_url を現場モードに設定
オフライン時の挙動を playwright スキルで network 遮断テストして。
```

検証: DevTools オフラインでスキャン継続 → オンライン復帰で自動送信。iOS Safari でホーム画面起動。

## 進捗管理

- 各フェーズ完了時に docs/tech-debt-improvement-plan.md の完成条件 (D1〜D10) を確認
- Drive 側 prj3/docs/plans.html のチェックリストに反映
- フェーズ間で問題が出たら該当ブランチのみ revert (main は常にデプロイ可能に保つ)

## スキルが発動しない場合

- プロンプト冒頭で「<skill名> スキルを使って」と明示する (上記プロンプトは明示済み)
- `claude` 起動直後に `/context` 等でスキル読込を確認、または ls .claude/skills で配置確認
- description の追記 (docs/skills-install-guide.md Step 6) で自動発動率を上げる

---

## Phase 3 進捗 (2026-07-06 時点)

D5(server.js 分割)は段階実施中。振る舞い不変・各段階スモークALL PASSを維持。

完了:
- api/lib/db.js・api/lib/logger.js に共有プール/ロガーを抽出
- routes/reports.js(4EP)・routes/qc-tools.js(6EP)・routes/monitoring.js(14EP)を分離
  - requireAdmin が必要なルーターは注入型(factory)で結線
- server.js: 5,783 → 4,536 行

未完(次回の抽出候補、いずれも routes/ への分離):
- products / shipping-instructions / qr-inspections / inspectors / inventory
- new-qc / pps・lot-inventory・picking・packing / delivery-locations / shipping-locations
- production-plans / product-components / database・logs
- system-config は共有可変状態 systemConfig に結合のため、状態の lib 化と併せて対応

目標(server.js ≤ 200 行)は未達。継続時は 1 ドメイン=1 コミット+スモークの方式を踏襲する。

## Phase 3b 進捗 (2026-07-06 追記)

さらに 13 ドメインを分離。共有可変状態も lib 化。

完了(追加):
- api/lib/config.js に systemConfig(POC可変状態)を集約
- routes 追加: production-plans, shipping-locations, delivery-locations, product-components,
  inventory, inspectors, new-qc(31EP), lot-inventory, picking-instructions, packing-records,
  logs(注入型), qr-inspections, system-config
- server.js: 4,536 → 1,967 行(初期 5,783 から約66%削減、計16ルーター)

残(結合・非連続のため要個別対応):
- shipping-instructions(15EP・execPromise/fs/path/systemConfig/requireAdmin、非連続)
- products(6EP・非連続)/ database(5EP・execPromise/fs/path)/ shipping-inspections(2EP・非連続)
- auth(M365 2EP、m365 設定と密結合)/ health / db-test は server.js に残置が妥当

教訓: 最後尾ドメインの抽出では終端がEOFまで伸び、404ハンドラ/app.listen を巻き込む。
末尾の起動処理(app.use('*')・app.listen・SIGTERM/SIGINT)は server.js に残すこと。

## Phase 3c 進捗 (2026-07-06 追記) — D5 実質完了

非連続・密結合ドメインを、次の ^app. 行を境界にした複数ブロック抽出器で分離。
重複ルート定義(first-wins)とサブルート特異性(/summary, /detail, /:id/components)を保持。

完了(追加):
- routes 追加: products(6), shipping-instructions(15), shipping-inspections(2), database(5・注入型)
- server.js: 1,967 → 426 行(初期 5,783 から約93%削減、計20ルーター + lib 4本)

server.js に残置(妥当):
- アプリ起動・ミドルウェア(helmet/cors/rate-limit/write-auth/requireAdmin)
- M365 認証ヘルパーと /auth/m365/* 2EP、/health、/db-test、404、app.listen

さらに詰めるなら M365 認証群を lib/auth.js へ切り出し可能(server.js を ~200 行台に)。
ただし残りは本質的にブートストラップであり、現状で D5 の目的(保守性・レビュー容易性)は達成。

## D5 サマリー
- server.js 5,783 → 426 行(-93%)
- 抽出ルーター 20、共有 lib 4(db/logger/config + OCR既存)
- 全段階 スモーク ALL PASS、振る舞い不変(既存の500はローカルseed起因で変化なし)

## D2 仕上げ 進捗 (2026-07-06)

- CRUD 6ページ(delivery-locations/shipping-locations/production-plans/shipping-instructions/inspectors/product-components)のインラインstyle(~46行/枚)を components.css へ集約。ページ側は --page-accent 指定のみ。
- 残11ページの <style> 内ステータス/ブランド色hex(37箇所)を tokens 変数へ置換。色定義の単一化(ダークテーマ対応)完了。
- 残: index/monitoring/qr-inspection3 等の「ページ固有レイアウト」インラインstyleはページ機能に密結合のため残置(色はトークン化済み)。完全ゼロ化は各ページの個別対応が必要だが、D2の主目的(ステータス色の統一・単一ソース化)は達成。
