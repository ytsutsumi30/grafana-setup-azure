# 出荷検品 POC on Azure Container Apps

このリポジトリは、出荷検品 / 生産管理アプリを Azure Container Apps + Supabase へ移行した POC です。

基本ドキュメントは日本語で作成します。システム構成、業務フロー、ロードマップなど図表が必要な資料は HTML First で作成します。詳細は `docs/documentation-policy.md` を参照してください。

## Current Endpoint

Public web endpoint:

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

Useful API checks through the web reverse proxy:

```bash
WEB_URL="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io"
curl "$WEB_URL/health"
curl "$WEB_URL/api/health"
curl "$WEB_URL/api/products"
curl "$WEB_URL/api/shipping-instructions"
curl "$WEB_URL/api/inspectors"
```

Internal API FQDN:

```text
shipping-inspection-poc-api.internal.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

`/api/db-test` is an administrator-only diagnostic endpoint. Use a configured M365 bearer token or `x-admin-token`; do not expose that token in browser code.

## Deployment Stack

- Azure region: `japaneast`
- Runtime: Azure Container Apps
- Registry: Azure Container Registry
- Database: Supabase PostgreSQL via Session Pooler
- IaC: Terraform under `infra/terraform`
- Monitoring: Log Analytics + Application Insights
- Optional auth: Microsoft 365 delegated sign-in with MSAL and Microsoft Graph
- Deferred: Grafana/Prometheus and GCP Document AI

## Terraform Deployment

```bash
cd infra/terraform
terraform plan
terraform apply
```

After infrastructure changes or image changes:

```bash
cd ~/grafana-setup-azure
./scripts/deploy-images-terraform.sh
```

Keep `terraform.tfvars`, Terraform state files, and Supabase credentials out of Git.

Apply the OCR feedback schema to an existing Supabase database after deployment:

```bash
SUPABASE_DB_URL='postgresql://...' ./scripts/apply-ocr-feedback-migration.sh
```

## Local Docker

Run: docker compose up -d --build

Open http://localhost:8080. See docs/docker-local.md for details.

## Validation

GitHub Actions runs API syntax checks, API unit tests, dependency audit, Docker smoke tests, and API contract tests.

Run the same checks locally:

```bash
npm --prefix api run check:syntax
npm --prefix api test
npm --prefix api run audit
docker compose up -d --build
BASE=http://localhost:8080 bash tests/smoke/smoke.sh
BASE=http://localhost:8080 node --test tests/api/contract.test.js
```

See `docs/testing-ci.md` for CI details and contract-test cautions.

For field review data readiness:

```bash
./scripts/check-field-review-data.sh
```

To seed local field-review demo data:

```bash
./scripts/seed-field-review-data.sh
```

To reset local field-review demo data before a manual UI review:

```bash
./scripts/reset-field-review-data.sh
```

To validate the seeded review data through the API:

```bash
./scripts/check-field-review-api.sh
```

To run the local field-review API rehearsal:

```bash
./scripts/run-field-review-api-scenario.sh
```

To collect local field-review evidence:

```bash
./scripts/collect-field-review-evidence.sh
```

Evidence is written under `review-evidence/`, which is local output and is ignored by Git.

## Documentation

- `docs/documentation-policy.md`: 日本語ドキュメントと HTML First の作成方針
- `docs/business-expansion-roadmap.html`: HTML First roadmap for business expansion
- `docs/endpoints.md`: current endpoints and validation commands
- `docs/testing-ci.md`: local validation, CI, and contract-test cautions
- `docs/field-review-checklist.md`: field review checklist for PPS, QR inspection, reports, and audit logs
- `docs/field-review-scenario.md`: step-by-step field review operation scenario
- `docs/field-review-demo-data.md`: demo data preparation notes for field review
- `docs/field-review-runbook.md`: field review day runbook and command order
- `docs/business-expansion-roadmap.md`: roadmap for inventory, purchasing, sales orders, manufacturing, traceability, and monitoring
- `docs/inventory-foundation-phase1-plan.md`: detailed Phase 1 plan for inventory, lot, QR, transactions, and operation events
- `docs/purchase-receiving-phase2-plan.md`: Phase 2 plan for purchasing, receiving orders, QR receiving inspection, and inventory reflection
- `docs/sales-order-shipping-phase3-plan.md`: Phase 3 plan for sales orders and shipping instruction generation
- `docs/inventory-count-phase4-plan.md`: Phase 4 plan for inventory count, variance, and adjustment approval
- `docs/grafana-cloud-minimal-monitoring.md`: Grafana Cloud minimal monitoring API and dashboard import notes
- `docs/ocr-import-phase5-plan.md`: Phase 5 plan for OCR import, sales order candidates, and delivery note matching
- `docs/manufacturing-orders-phase6-plan.md`: Phase 6 plan for work orders, operations, material consumption, and finished goods receipt
- `docs/traceability-phase7-plan.md`: Phase 7 plan for cross-document lot and QR traceability
- `docs/terraform-deployment.md`: Terraform workflow
- `docs/supabase-migration.md`: Supabase setup and schema migration
- `docs/m365-delegated-auth.md`: Microsoft 365 delegated authentication setup
- `docs/gcp-document-ai-deferred-plan.md`: deferred GCP plan
