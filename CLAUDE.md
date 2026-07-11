# CLAUDE.md — 出荷検品アプリ (prj3)

## 概要

生産管理・出荷検品 Web アプリ。QR 検品 / ピッキング / 在庫 / 受発注 / OCR。現場端末 (iPad・Android・iOS Safari) での利用が前提。

## 技術スタック

| 層 | 技術 |
|----|------|
| フロント | 静的 HTML + Vanilla JS + Bootstrap (vendor 同梱) / nginx 配信 |
| API | Node.js 18+ / Express (`api/` — routes / services / lib に分割済み) |
| DB | PostgreSQL (ローカル: Docker / 本番: Supabase) |
| インフラ | Docker Compose / Azure Container Apps / Terraform (`infra/terraform`) |
| 監視 | Application Insights + Grafana 埋め込み (同一オリジン iframe) |

## よく使うコマンド

| 操作 | コマンド |
|------|---------|
| ローカル一式起動 | `docker compose up -d` → web: :8080 / api: :3002 / postgres: :5433 |
| 停止 | `docker compose down` |
| API 単体開発 | `cd api && npm run dev` |
| Supabase 関連 | `scripts/*.sh` (schema 適用・tfvars 設定ほか) |
| IaC 差分 | `cd infra/terraform && terraform plan` (Set型偽陽性は terraform-azurerm-set-diff-analyzer スキル) |

## ディレクトリ

| 場所 | 内容 |
|------|------|
| `web/` | フロントエンド。**変更時は prj3-frontend スキルの規約・完了前チェックに必ず従う** |
| `api/` | Express API |
| `infra/` | Bicep + Terraform |
| `docs/` | 計画・設計文書 (最新計画: shipping-inspection-next-plan.md / スキル一覧: skills-installed.md) |
| `postgres/` | ローカル DB 初期化 SQL |
| `.claude/skills/` | プロジェクトスキル 14 本 (git 管理) |

## 行動原則

- 応答は日本語。実装前に計画を 1〜5 行で提示し、承認後に最小差分で実装する。
- 現状評価は `assessment.md`、移行状況は `migration-status.md` を参照。
- 機密 (接続文字列・tfvars・tfstate) をコミットや共有フォルダに置かない。
- 実験・旧版ファイルを web/ 直下に増やさない (`web/_archive/` へ)。
