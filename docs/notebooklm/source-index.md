# NotebookLM ソース索引

## 最初に読む資料

1. `00-README.md`
   - プロジェクトの概要、起動方法、主要機能の入口。
2. `01-business-expansion-roadmap.md`
   - 出荷検品以外の在庫、受発注、棚卸、OCR、製造、トレーサビリティへの拡張計画。
3. `02-shipping-inspection-next-plan.md`
   - 出荷検品アプリ本体の次期改善計画。

## Phase 別設計資料

4. `03-inventory-foundation-phase1-plan.md`
   - 在庫、ロット、QR 共通基盤。
5. `04-purchase-receiving-phase2-plan.md`
   - 発注、入庫、QR/ロット入庫。
6. `05-sales-order-shipping-phase3-plan.md`
   - 受注、出荷指示生成。
7. `06-inventory-count-phase4-plan.md`
   - 棚卸。
8. `07-ocr-import-phase5-plan.md`
   - OCR 取込。
9. `08-manufacturing-orders-phase6-plan.md`
   - 製造指図、工程実績、材料投入、完成品入庫。
10. `09-traceability-phase7-plan.md`
    - ロット、QR、伝票、製造指図の横断トレース。

## 運用・基盤資料

11. `10-grafana-cloud-minimal-monitoring.md`
    - Grafana Cloud 最小監視。
12. `11-m365-delegated-auth.md`
    - M365 ログイン、代理認証。
13. `12-azure-container-apps.md`
    - Azure Container Apps ホスティング。
14. `13-supabase-migration.md`
    - Supabase 移行。
15. `14-testing-ci.md`
    - テスト、CI、検証方針。
16. `15-endpoints.md`
    - API エンドポイント一覧。

## NotebookLM での読み方

- 業務全体を知りたい場合は、最初に `00` から `02` を参照する。
- 実装順を確認する場合は、`03` から `09` を参照する。
- Azure、Supabase、M365、Grafana の構成確認は `10` から `13` を参照する。
- テストや API の確認は `14` と `15` を参照する。
