# Agent Skills 導入・適用 全体計画

この文書は、公開されている Agent Skills(anthropic/skills 16 件、openai/skills 30 件、github/awesome-copilot 43 件、計 89 件)から、出荷検品アプリおよび 4 計画(在庫・棚卸、受発注・製造指図、Grafana 埋め込み、UI 改善)の開発に有効なスキルを選定し、導入・適用するための計画書です。

参考: Qiita「【2026/02版】Agent Skills 一覧と活用ガイド: Anthropic / OpenAI / awesome-copilot」

関連文書:

- docs/ui-improvement-plan.md
- docs/grafana-embedding-plan.md
- docs/manufacturing-inventory-plan.md
- docs/manufacturing-order-plan.md
- docs/plans.html (統合ポータル。本計画は「スキル導入」タブ)

## 目的

AI エージェント(Claude Code / Cowork)での開発作業に、実績あるスキルとプロジェクト専用スキルを組み込み、実装品質の均一化・レビューの体系化・作業の再現性向上を図ります。

## 基本方針

- 汎用スキルは「そのまま効くもの」だけを厳選して導入する。導入数を増やすことより、確実に使う場面がある少数に絞る。
- 最も効果が大きいのはプロジェクト専用スキルの自作。プロジェクトの規約・手順・資産(デザイントークン、スキーマ適用スクリプト、ダッシュボード JSON)をスキル化し、生成物の流儀を固定する。
- スキルはリポジトリの `.claude/skills/` に置きプロジェクト共有とする(個人利用のみ `~/.claude/skills/`)。
- セキュリティ系スキルは全計画の前提として最初に適用する(assessment.md の未解決指摘に直結)。

## 採用スキル一覧

### A. UI 改善計画に直結(優先度: 高)

| スキル | 出典 | 適用先 |
|--------|------|--------|
| frontend-design | anthropic/skills | UI 改善 Phase 1-2。共通コンポーネント・現場 UI の実装品質向上 |
| theme-factory | anthropic/skills | デザイントークン(tokens.css)・ダークテーマ生成 |
| web-design-reviewer | awesome-copilot | 既存ページのレビュー、改善後の検証 |
| playwright | openai/skills | 検品フロー・PWA オフラインの E2E テスト |
| webapp-testing | anthropic/skills | テスト戦略(Playwright MCP 連携) |

### B. セキュリティ(優先度: 高)

| スキル | 出典 | 適用先 |
|--------|------|--------|
| security-best-practices | openai/skills | Node.js API のレビュー。認証なし・backup/restore 無防備・CORS 全開の是正 |
| security-threat-model | openai/skills | 公開 POC の脅威モデリング。M365 認証・Grafana 埋め込み導入前に実施 |

### C. コード品質・インフラ(優先度: 中)

| スキル | 出典 | 適用先 |
|--------|------|--------|
| refactor | awesome-copilot | 巨大単一 server.js(約 130 エンドポイント)のルート分割 |
| terraform-azurerm-set-diff-analyzer | awesome-copilot | infra/terraform の plan 差分検証(Grafana コンテナ追加時) |
| appinsights-instrumentation | awesome-copilot | API の Application Insights 計装強化 |
| azure-resource-visualizer | awesome-copilot | ACA 構成図の自動生成(ドキュメント用) |

### D. 設計・ドキュメント(優先度: 中)

| スキル | 出典 | 適用先 |
|--------|------|--------|
| prd | awesome-copilot | 受発注・製造指図の要件定義(計画書 → PRD 詳細化) |
| doc-coauthoring | anthropic/skills | 各計画 Phase 1 の設計文書作成 |
| web-artifacts-builder | anthropic/skills | HTML ファーストドキュメント(plans.html 等)の品質向上 |
| skill-creator | anthropic/skills | 下記プロジェクト専用スキルの作成 |

### E. 見送り

- figma / figma-implement-design / penpot-uiux-design: デザインツール未使用
- sentry: 監視は Grafana / Grafana Cloud を採用
- powerbi-modeling / snowflake-semanticview: データ基盤が対象外
- copilot-sdk / copilot-cli-quickstart / vscode-ext 系: 開発環境が対象外
- sora / speech / transcribe / imagegen 等メディア生成系: 現時点で用途なし(アイコン生成等が必要になれば imagegen を検討)
- cloudflare / netlify / vercel / render 系デプロイ: ACA + Terraform を採用済み
- docx / xlsx / pdf / pptx: Cowork に導入済み

## プロジェクト専用スキル(自作)

skill-creator を使って以下の 4 スキルを作成します。汎用スキルより効果が大きく、生成物の流儀をプロジェクト規約に固定できます。

### prj3-frontend

```text
内容:
- tokens.css / components.css の規約(ステータス色、--touch-target-*)
- 共通ナビ(layout.js)の組み込み方法
- 現場 UI 基準(48/64px、スキャンフィードバック仕様、sticky アクションバー)
- CDN 禁止・vendor/ 参照のルール
効果: 画面の新規作成・改修が常に同じ流儀で生成される
```

### prj3-db-migration

```text
内容:
- Supabase スキーマ適用手順(scripts/prepare|apply-supabase-schema.sh)
- テーブル命名規約、追記型履歴(inventory_transactions)の原則
- 読み取り専用ロールの管理、RLS 方針
効果: 在庫・受発注計画のテーブル追加作業を安全に定型化
```

### prj3-grafana-dashboard

```text
内容:
- ダッシュボード JSON 規約(uid 命名、テンプレート変数、theme)
- REST API 投入パターン(Grafana プロジェクトの scripts/ 資産を標準化)
- d-solo / kiosk 埋め込み URL の規約
効果: 埋め込み用ダッシュボードの作成・更新を CI 化しやすくする
```

### prj3-deploy

```text
内容:
- Terraform plan/apply → deploy-images-terraform.sh の定型手順
- secrets の扱い(tfvars/state を Git に含めない)
- デプロイ後検証(/health、/api/health、/api/db-test)
効果: デプロイ作業の抜け漏れ防止
```

## 導入方法

```text
プロジェクト共有 (推奨):
  prj3 リポジトリに .claude/skills/<skill-name>/SKILL.md を配置
  各リポジトリ (anthropics/skills, openai/skills, github/awesome-copilot)
  から対象スキルをコピーし、必要ならプロジェクト向けに追記

個人利用:
  ~/.claude/skills/ に配置

Cowork:
  設定 > Capabilities からスキルを追加
```

導入時の注意:

- スキルの説明(frontmatter の description)が発動条件になるため、コピー後にプロジェクト文脈の語(検品、出荷指示など)を追記すると発動精度が上がる。
- 依存ツール(playwright、gh CLI、networkx 等)は WSL2 側にインストールする。
- 定期的に上流リポジトリの更新を確認する(四半期に 1 回程度)。

## 適用ロードマップ(計画フェーズとの対応)

### Step 1: 即時(全計画の前提)

- security-best-practices / security-threat-model で現行 API を監査
- skill-creator で prj3-frontend を作成

### Step 2: UI 改善 Phase 1-2 と並行

- frontend-design + theme-factory で共通基盤を実装
- web-design-reviewer で改修結果をレビュー
- ページ整理後、playwright で主要フロー(検品・ピッキング)の E2E を整備

### Step 3: 在庫計画 Phase 2 以降

- prj3-db-migration を作成・運用開始
- refactor で server.js のルート分割(新テーブル・新 API 追加前が効率的)

### Step 4: Grafana 計画 Phase 2 以降

- prj3-grafana-dashboard を作成・運用
- terraform-azurerm-set-diff-analyzer で Grafana コンテナ追加時の plan を検証

### Step 5: 受発注計画 Phase 1

- prd + doc-coauthoring で受注・発注・製造指図の詳細要件化

### Step 6: 継続運用

- prj3-deploy を作成し、デプロイを定型化
- appinsights-instrumentation で計装を強化
- azure-resource-visualizer で構成図をドキュメントに反映

## 完成条件

```text
採用スキルが .claude/skills/ に配置され、エージェントから発動する。
セキュリティ 2 スキルによる監査レポートが作成され、指摘が課題管理されている。
prj3-frontend により新規画面が共通規約で生成される。
主要フローの E2E テストが playwright スキル経由で実行できる。
server.js のリファクタリング計画が refactor スキルで作成されている。
プロジェクト専用スキル 4 件が作成・運用されている。
```

## 後回しにする項目

- imagegen によるアイコン・モックアップ生成(必要になった時点で導入)
- mcp-builder によるアプリ API の MCP サーバー化
- agentic-eval によるエージェント出力の体系的評価
- gh-cli / gh-fix-ci 等の GitHub 運用系(リポジトリ運用方針の確定後)
