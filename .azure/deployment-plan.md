# Azure Deployment Plan

> **Status:** Deployed

Generated: 2026-06-29
Updated: 2026-08-01

---

## 1. Project Overview

**Goal:** Migrate the existing shipping inspection / production management app from WSL Docker Compose on an AWS-style EC2/RDS setup to Azure Container Apps with Supabase PostgreSQL.

**Path:** Modernize Existing / Cross-cloud migration

**Source:** `/home/tsutsumi/grafana-setup`

**Migration Output:** `/home/tsutsumi/grafana-setup-azure`

---

## 2. Confirmed Requirements

| Attribute | Value |
|-----------|-------|
| Classification | POC |
| Scale | Small |
| Budget | Cost-Optimized |
| Azure Location | `japaneast` |
| Supabase | Create new project |
| Grafana/Prometheus | Deferred |
| GCP Document AI | Deferred, planned for later |
| Public entrypoint | Azure Container Apps `web` app |
| API exposure | Internal Container App where possible |

稼働コンテキスト:

- Azure subscription: `a5106b35-61fe-44cb-8f74-9f5f5a738ef4`
- Supabase project ref: `ffhgeppjrcylrufcqbep`
- Azure resource group: `rg-shipping-inspection-poc`

---

## 3. Components Prepared

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| `web` | Static frontend | HTML/CSS/JS served by nginx | `/home/tsutsumi/grafana-setup-azure/web` |
| `api` | API Service | Node.js 20 / Express / pg | `/home/tsutsumi/grafana-setup-azure/api` |
| `postgres` | Database schema | PostgreSQL SQL migrations/seeds | `/home/tsutsumi/grafana-setup-azure/postgres`, `/home/tsutsumi/grafana-setup-azure/api/migrations` |
| `grafana` | Optional monitoring | Grafana | Deferred |
| `prometheus` | Optional monitoring | Prometheus | Deferred |
| `gcp-document-ai` | Optional OCR | GCP Document AI | Deferred |

---

## 4. Recipe Selection

**Selected:** Terraform

**Rationale:**

- Target is Azure Container Apps with ACR, Log Analytics, Application Insights, and two Container Apps.
- Existing Terraform is AWS/GCP-specific and was not reused.
- `azure.yaml` is available for Azure Developer CLI once `azd` is installed.
- `infra/main.bicep` can also be deployed directly with Azure CLI.

---

## 5. Architecture

**Stack:** Containers

| Component | Service | Shape |
|-----------|---------|-------|
| `web` | Azure Container Apps | External ingress, 0.25 vCPU / 0.5Gi, min 1 replica |
| `api` | Azure Container Apps | Internal ingress, 0.5 vCPU / 1Gi, min 1 replica |
| Images | Azure Container Registry | Basic |
| Logs | Log Analytics Workspace | 30 day retention |
| APM | Application Insights | Workspace-based |
| Database | Supabase PostgreSQL | New Supabase project |
| Secrets | Container Apps secrets | Supabase credentials, later OCR credentials |

---

## 6. Provisioning Inventory

Azure subscription と `japaneast` の対象リソースを確認済み。

Deployed Azure inventory:

| Resource Type | Number to Deploy | Notes |
|---------------|------------------|-------|
| `Microsoft.App/managedEnvironments` | 1 | Container Apps environment |
| `Microsoft.App/containerApps` | 2 | `web`, `api` |
| `Microsoft.ContainerRegistry/registries` | 1 | Basic ACR |
| `Microsoft.OperationalInsights/workspaces` | 1 | Log Analytics |
| `Microsoft.Insights/components` | 1 | Application Insights |

Terraform、ACR、Container Apps、RBAC の事前検証とデプロイ後確認を完了した。

---

## 7. Prepared Files

| File | Purpose | Status |
|------|---------|--------|
| `azure.yaml` | AZD service configuration | Done |
| `infra/main.bicep` | Azure Container Apps infrastructure | Done, Bicep build passed |
| `infra/main.parameters.json` | Non-secret defaults | Done |
| `api/Dockerfile` | API image | Done, Docker build passed |
| `web/Dockerfile` | Web/nginx image | Done, Docker build passed |
| `nginx/default.conf.template` | Reverse proxy template | Done |
| `web/default.conf.template` | Build-context copy for nginx image | Done |
| `.dockerignore` | Prevent secrets/logs/node_modules in images | Done |
| `scripts/create-supabase-project.sh` | Supabase Management API project creation | Done |
| `scripts/prepare-supabase-schema.sh` | Schema concatenation for Supabase | Done |
| `supabase-schema.sql` | Generated schema SQL | Done |
| `docs/supabase-migration.md` | Supabase runbook | Done |
| `docs/azure-container-apps.md` | Azure deployment notes | Done |
| `docs/gcp-document-ai-deferred-plan.md` | Deferred GCP plan | Done |

---

## 8. Validation Proof So Far

| Check | Command | Result |
|-------|---------|--------|
| Generate Supabase schema | `./scripts/prepare-supabase-schema.sh` | Pass, 882 lines |
| Bicep syntax | `az bicep build --file infra/main.bicep` | Pass |
| API image build | `docker build -t shipping-inspection-api:test ./api` | Pass |
| Web image build | `docker build -t shipping-inspection-web:test ./web` | Pass |
| API health | Temporary Docker run + `curl /health` | Returned OK JSON |
| Web health | Temporary Docker run + `curl /health` | Returned `healthy` |

---

## 9. Next Steps

1. M365 認証済みブラウザで在庫、入庫、受注、出荷の業務 API を最終確認する。
2. 本番移行前に Supabase の CA 検証を有効化する。
3. AWS SDK のサポート期限に備え、2027 年 1 月までに API runtime を Node.js 22 へ更新する。
4. Grafana Cloud 最小監視を導入する。

## 10. Terraform Primary Path

Terraform files are in /home/tsutsumi/grafana-setup-azure/infra/terraform. Use docs/terraform-deployment.md for deployment. The original /home/tsutsumi/grafana-setup/terraform is AWS-specific and is not used.


## 11. Current Endpoint

Public web endpoint: `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io`

Internal API FQDN: `shipping-inspection-poc-api.internal.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io`

Validated endpoints: `/health`, `/api/health`, `/api/db-test`, `/api/products`, `/api/shipping-instructions`, `/api/inspectors`.

## 12. Validation Proof (2026-07-17)

| Check | Command | Result |
|-------|---------|--------|
| Azure context | `az account show` | Pass: subscription `a5106b35-61fe-44cb-8f74-9f5f5a738ef4` |
| Terraform syntax | `terraform -chdir=infra/terraform validate` | Pass |
| Terraform outputs | `terraform -chdir=infra/terraform output -json` | Pass: `japaneast`, expected ACR and Container Apps |
| Local application verification | `TARGET_PAGE=purchase-receiving RELATED_TESTS='tests/api/contract.test.js tests/ui/purchase-receiving.test.js' bash scripts/verify-ui-change.sh` | Pass: HTTP 200, console error 0, smoke pass, 48 tests pass |
| ACR connectivity | `az acr check-health -n crstezvvdoshippinginspectionpoc --yes --ignore-errors` | Pass: Docker, DNS, challenge endpoint and token checks |
| Container Apps state | `az containerapp show` / `az containerapp env list` | Pass: environment, API and web are `Succeeded`; apps are `Running` |
| ACR pull RBAC | `az role assignment list` for both system-assigned identities | Pass: `AcrPull` confirmed for API and web |
| Static RBAC definition | `rg -n 'azurerm_role_assignment|AcrPull' infra/terraform -g '*.tf'` | Pass: API and web role assignments defined |
| Template resolution | Search for unresolved `{{ .Env.* }}` in Terraform | Pass: none found |

## 13. Deployment Result (2026-07-17)

| Component | Image | Ready revision | Result |
|-----------|-------|----------------|--------|
| API | `shipping-inspection-api:receiving-ui-20260717-000058` | `shipping-inspection-poc-api--0000023` | Running |
| Web | `shipping-inspection-web:receiving-ui-fix-20260717-001200` | `shipping-inspection-poc-web--0000026` | Running |

- Initial web revision `0000025` entered `CrashLoopBackOff` because the local Grafana upstream name was not resolvable in Azure Container Apps.
- `GRAFANA_UPSTREAM` was made environment-specific: local Compose uses `http://grafana:3000`; the ACA image uses a loopback default when Grafana is not deployed.
- Public verification passed for `/health`, `/index.html`, `/purchase-receiving.html`, `/api/health`, and the deployed `purchase-receiving.js` marker.
- Public Playwright verification for `purchase-receiving.html` completed with console error 0. The M365 sign-in wall displayed as configured.

## 14. リリース結果 (2026-08-01)

### Azure / Supabase

| 対象 | 結果 |
|------|------|
| Terraform plan | 差分なし (`No changes`) |
| Terraform apply | `0 added, 0 changed, 0 destroyed` |
| Supabase | 業務機能用マイグレーション 10 本を依存順に適用 |
| API image | `shipping-inspection-api:ui-release-20260801-032240` |
| API digest | `sha256:531253f85254a0799ea181a9a34df376704cd4ab21c6ea961620865de8c15258` |
| API revision | `shipping-inspection-poc-api--0000027` (`Healthy`, `Running`) |
| Web image | `shipping-inspection-web:ui-release-20260801-032240` |
| Web digest | `sha256:f01716f27808268d3a880c24da9588630e39e4927415f2696d3892fb1c8d0156` |
| Web revision | `shipping-inspection-poc-web--0000028` (`Healthy`, `Running`) |
| ACR build | API run `ce1m`、Web run `ce1n` とも成功 |

- 入庫、受注、棚卸、OCR、製造、在庫台帳、QR、出荷監査で使用する対象テーブルが Supabase に存在することを確認した。
- `production_user` が存在しない Supabase 環境でも適用できるよう、権限付与をロール存在時のみ実行する冪等マイグレーションへ修正した。
- Windows 版 Azure CLI を WSL から使う場合、ACR build context を `wslpath -w` で UNC パスへ変換するよう配備スクリプトを修正した。
- `DB_SSL_REJECT_UNAUTHORIZED=false` は POC の許容リスクとして継続する。本番移行前に CA 検証を有効化する。

### 公開エンドポイント検証

| パス | 未認証時の結果 | 判定 |
|------|----------------|------|
| `/health` | `200` | Pass |
| `/api/health` | `200` | Pass |
| `/index.html` | `200` | Pass |
| `/inventory-foundation.html` | `200` | Pass |
| `/purchase-receiving.html` | `200` | Pass |
| `/sales-shipping.html` | `200` | Pass |
| `/shipping-instructions.html` | `200` | Pass |
| 業務 API | `401` | Pass: M365 認証必須の想定どおりで、`500` は再現しない |

### リリース前品質ゲート

| チェック | 結果 |
|----------|------|
| API、契約、統合、UI、Service Worker テスト | `87/87` Pass |
| ローカル主要 12 画面 console check | error 0、すべて Pass |
| API production dependency audit | `0 vulnerabilities` |
| Git staged diff check | Pass |
| staged secret scan | 検出なし |
| Git 除外 | `terraform.tfvars`、Terraform state、`supabase-project.json`、`.codex/` を除外 |

公開 URL: `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io`
