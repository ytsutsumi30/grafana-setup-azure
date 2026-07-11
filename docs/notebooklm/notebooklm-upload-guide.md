# NotebookLM アップロード手順

## 推奨投入方法

NotebookLM には、まず次の 2 ファイルを追加する。

1. `notebooklm-combined-source.pdf`
2. `notebooklm-prompts.md`

この 2 ファイルで、プロジェクト概要、ロードマップ、Phase 別設計、Azure/Supabase/M365/Grafana、テスト、API の主要情報を参照できる。

## Google Drive 上の配置先

`G:\マイドライブ\AI-Memory\projects\prj3\notebooklm`

## NotebookLM 操作

1. NotebookLM を開く。
2. 新しいノートを作成する。
3. ノート名を `出荷検品・製造業務 POC 計画` にする。
4. ソース追加で Google Drive を選ぶ。
5. 上記 Drive フォルダから `notebooklm-combined-source.pdf` を追加する。
6. 続けて `notebooklm-prompts.md` を追加する。
7. 必要に応じて `sources/` 配下の個別 Markdown を追加する。

## 個別ソースを追加する場合

NotebookLM の回答で引用元を細かく分けたい場合は、次の順に追加する。

1. `00-notebooklm-project-brief.md`
2. `source-index.md`
3. `sources/00-README.md`
4. `sources/01-business-expansion-roadmap.md`
5. `sources/02-shipping-inspection-next-plan.md`
6. `sources/03-inventory-foundation-phase1-plan.md`
7. `sources/04-purchase-receiving-phase2-plan.md`
8. `sources/05-sales-order-shipping-phase3-plan.md`
9. `sources/06-inventory-count-phase4-plan.md`
10. `sources/07-ocr-import-phase5-plan.md`
11. `sources/08-manufacturing-orders-phase6-plan.md`
12. `sources/09-traceability-phase7-plan.md`
13. `sources/10-grafana-cloud-minimal-monitoring.md`
14. `sources/11-m365-delegated-auth.md`
15. `sources/12-azure-container-apps.md`
16. `sources/13-supabase-migration.md`
17. `sources/14-testing-ci.md`
18. `sources/15-endpoints.md`

## 最初に聞く質問

`notebooklm-prompts.md` の「全体把握」から始める。

推奨:

> この POC の目的、対象業務、現在の実装済み範囲を要約してください。

次に:

> 推奨実装順に対して、完了済み、実装中、未着手、リスクありを整理してください。

## 注意

- Terraform state、`terraform.tfvars`、Supabase 接続情報、アクセストークン、秘密鍵は追加しない。
- ソースコード全体は追加しない。
- 画面や API の詳細実装レビューが必要になった時だけ、対象ファイルを個別に追加する。
