# 適用中スキル一覧

最終更新: 2026-07-07
本書は、開発に使用している 2 つの実行環境それぞれに現在適用されているスキルをまとめたものです。

> 2026-07-07 リファクタ実施: 全 SKILL.md を「DO / DON'T / OUTPUT FORMAT」の3ブロック構成へ統一し、description を発火条件ベースに書き直し。webapp-testing は playwright に統合、web-artifacts-builder は Claude Code 環境で機能しないため除外。両者は `.claude/skills-archive/` に退避(git 履歴からも復元可)。

## 環境1: WSL2 Claude Code(実装の主環境)

配置先: `~/grafana-setup-azure/.claude/skills/`(プロジェクト共有・git 管理)
合計: 14 スキル(公開 13 + 自作 1)。導入手順は docs/skills-install-guide.md 参照。

### 公開スキル(13)

| # | スキル | 出所 | ジャンル | 用途(prj3) |
|---|--------|------|----------|-------------|
| 1 | security-best-practices | openai/skills | セキュリティ | API のセキュリティレビュー(Phase 0 で使用) |
| 2 | security-threat-model | openai/skills | セキュリティ | 脅威モデリング(Phase 0 で使用) |
| 3 | playwright | openai/skills | テスト自動化 | ブラウザ E2E / スモーク / ローカルアプリ画面検証(旧 webapp-testing の役割を統合) |
| 4 | prd | openai/skills | 設計 | 受発注・製造指図の要件定義(受発注 Phase 1 予定) |
| 5 | frontend-design | anthropic/skills | Web開発 | 新規 UI のデザイン方向付け(prj3 web/ では prj3-frontend が優先) |
| 6 | theme-factory | anthropic/skills | デザイン | 成果物へのテーマ選定・適用(prj3 の実装トークンは tokens.css が正) |
| 7 | doc-coauthoring | anthropic/skills | ドキュメント | 設計文書の共著(各 Phase 1 予定) |
| 8 | skill-creator | anthropic/skills | AI開発ツール | 自作スキルの作成・評価(prj3-frontend を作成) |
| 9 | refactor | github/awesome-copilot | コード品質 | server.js の分割ほか段階的改善(Phase 3) |
| 10 | web-design-reviewer | github/awesome-copilot | Web開発 | 実装後画面のビジュアルレビュー(Phase 2 で使用) |
| 11 | terraform-azurerm-set-diff-analyzer | github/awesome-copilot | IaC | Terraform plan 差分検証(Grafana 追加時予定) |
| 12 | appinsights-instrumentation | github/awesome-copilot | クラウド監視 | API 計装強化(継続運用予定) |
| 13 | azure-resource-visualizer | github/awesome-copilot | クラウド可視化 | ACA 構成図生成(ドキュメント用) |

出所内訳: anthropic/skills 4、openai/skills 4、github/awesome-copilot 5。

### 自作スキル(1)

| # | スキル | 出所 | 用途 |
|---|--------|------|------|
| 14 | prj3-frontend | 自作(skill-creator) | 出荷検品アプリの web/ フロントエンド規約。ページ骨格・CDN 禁止・デザイントークン参照・現場 UI 基準(48/64px、スキャンフィードバック)・オフラインキュー・Grafana 埋め込み。Phase 2 で使用 |

### アーカイブ済み(.claude/skills-archive/)

| スキル | 理由 |
|--------|------|
| webapp-testing | playwright と役割重複のため統合(2026-07-07)。Python 方式が必要になれば復元可 |
| web-artifacts-builder | claude.ai Artifacts 専用で Claude Code 環境では機能しないため(2026-07-07) |

### 実際に稼働で使用した実績(Phase 0-2)

```text
Phase 0 (セキュリティ): security-threat-model / security-best-practices
Phase 1 (ページ整理):   playwright(スモーク)
Phase 2 (共通基盤):     frontend-design / theme-factory / web-design-reviewer / prj3-frontend
自作:                   skill-creator(prj3-frontend を作成)
```

## 環境2: Cowork(Claude Desktop / 計画・ドキュメント作成)

Cowork に既定で利用可能なスキル(設定 > スキル / Capabilities で管理)。
主に計画書・ドキュメント作成に使用。

### Anthropic 公式(出力・ユーティリティ)

| スキル | 用途 |
|--------|------|
| docx | Word 文書の作成・編集 |
| pdf | PDF の作成・抽出・結合 |
| pptx | PowerPoint の作成・編集 |
| xlsx | Excel の作成・編集・分析 |
| schedule | 定期タスクの作成 |
| skill-creator | スキルの作成・改善(prj3-frontend 作成に使用) |
| setup-cowork | Cowork 初期セットアップ |
| consolidate-memory | メモリ整理 |

### プラグイン(cowork-plugin-management)

| スキル | 用途 |
|--------|------|
| create-cowork-plugin | プラグインの新規作成 |
| cowork-plugin-customizer | プラグインのカスタマイズ |

## 未導入だが導入予定・検討中

導入計画は docs/skills-adoption-plan.md 参照。以下は今後の Phase で自作予定の prj3 専用スキル。

| スキル | 作成タイミング |
|--------|----------------|
| prj3-db-migration | 在庫計画 Phase 2 開始時 |
| prj3-grafana-dashboard | Grafana 計画 Phase 2 開始時 |
| prj3-deploy | 継続運用フェーズ |

## 参考

- 導入手順: docs/skills-install-guide.md
- 選定理由: docs/skills-adoption-plan.md
- 実行計画: docs/tech-debt-execution-plan.md
