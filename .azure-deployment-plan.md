# Azure Deployment Plan

> **Status:** Execution Prepared - Waiting for Supabase/Azure Credentials

Generated: 2026-06-29
Updated: 2026-06-29

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

Pending:

- Azure subscription ID/name.
- Supabase personal access token and organization ID, or authenticated Supabase CLI/API context.
- Supabase DB password for the new project.

---

## 3. Components Prepared

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| `web` | Static frontend | HTML/CSS/JS served by nginx | `/home/tsutsumi/grafana-setup-azure/web` |
| `api` | API Service | Node.js 18 / Express / pg | `/home/tsutsumi/grafana-setup-azure/api` |
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

## 6. Provisioning Limit Checklist

Not completed because Azure subscription is not confirmed.

Planned Azure inventory:

| Resource Type | Number to Deploy | Notes |
|---------------|------------------|-------|
| `Microsoft.App/managedEnvironments` | 1 | Container Apps environment |
| `Microsoft.App/containerApps` | 2 | `web`, `api` |
| `Microsoft.ContainerRegistry/registries` | 1 | Basic ACR |
| `Microsoft.OperationalInsights/workspaces` | 1 | Log Analytics |
| `Microsoft.Insights/components` | 1 | Application Insights |

Quota validation must be run after subscription confirmation and before deployment.

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

1. Provide or configure Supabase access: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID`, and `SUPABASE_DB_PASSWORD`.
2. Create Supabase project with `scripts/create-supabase-project.sh`.
3. Apply `supabase-schema.sql` to Supabase.
4. Confirm Azure subscription.
5. Run Azure quota validation for `japaneast`.
6. Deploy Azure resources and images.
7. Validate web URL, `/api/db-test`, products, shipping instructions, and QR inspection flow.

## 10. Terraform Primary Path

Terraform files are in /home/tsutsumi/grafana-setup-azure/infra/terraform. Use docs/terraform-deployment.md for deployment. The original /home/tsutsumi/grafana-setup/terraform is AWS-specific and is not used.


## 11. Current Endpoint

Public web endpoint: `https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io`

Internal API FQDN: `shipping-inspection-poc-api.internal.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io`

Validated endpoints: `/health`, `/api/health`, `/api/db-test`, `/api/products`, `/api/shipping-instructions`, `/api/inspectors`.
