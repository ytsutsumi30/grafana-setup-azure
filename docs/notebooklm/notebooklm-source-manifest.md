# NotebookLM ソース投入マニフェスト

## ノート名

`出荷検品・製造業務 POC 計画`

## 最小投入セット

NotebookLM へ最初に追加するファイルは次の 2 つです。

1. `notebooklm-combined-source.pdf`
   - プロジェクト概要、ロードマップ、Phase 別設計、Azure/Supabase/M365/Grafana、テスト、API の主要情報を統合した PDF。
   - PDF は 66 ページで、NotebookLM の単一ソースとして扱いやすい。
2. `notebooklm-prompts.md`
   - NotebookLM で使う質問テンプレート。
   - 全体把握、現場レビュー、設計レビュー、Azure/Supabase/認証、次アクション整理に使う。

## 追加投入セット

引用元を細かく分けたい場合は、次の順で個別ソースも追加します。

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

## Google Drive 配置先

`G:\マイドライブ\AI-Memory\projects\prj3\notebooklm`

## ZIP

`G:\マイドライブ\AI-Memory\projects\prj3\notebooklm-upload-pack.zip`

## NotebookLM 操作メモ

1. NotebookLM を開く。
2. 新規ノートを作成する。
3. ノート名を `出荷検品・製造業務 POC 計画` にする。
4. ソース追加で Google Drive を選択する。
5. `G:\マイドライブ\AI-Memory\projects\prj3\notebooklm` から `notebooklm-combined-source.pdf` を追加する。
6. 同じフォルダから `notebooklm-prompts.md` を追加する。
7. 読み込み完了後、`notebooklm-prompts.md` の質問を使う。

## 最初に実行する質問

```text
この POC の目的、対象業務、現在の実装済み範囲を要約してください。
```

次に実行する質問:

```text
推奨実装順に対して、完了済み、実装中、未着手、リスクありを整理してください。
```

## 投入禁止

- Terraform state
- `terraform.tfvars`
- Supabase 接続情報
- アクセストークン
- 秘密鍵
- ソースコード全体
