# Shipping Inspection POC on Azure Container Apps

This repository contains the Azure Container Apps + Supabase migration of the shipping inspection / production management application.

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
curl "$WEB_URL/api/db-test"
curl "$WEB_URL/api/products"
curl "$WEB_URL/api/shipping-instructions"
curl "$WEB_URL/api/inspectors"
```

Internal API FQDN:

```text
shipping-inspection-poc-api.internal.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

## Deployment Stack

- Azure region: `japaneast`
- Runtime: Azure Container Apps
- Registry: Azure Container Registry
- Database: Supabase PostgreSQL via Session Pooler
- IaC: Terraform under `infra/terraform`
- Monitoring: Log Analytics + Application Insights
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

## Documentation

- `docs/endpoints.md`: current endpoints and validation commands
- `docs/terraform-deployment.md`: Terraform workflow
- `docs/supabase-migration.md`: Supabase setup and schema migration
- `docs/gcp-document-ai-deferred-plan.md`: deferred GCP plan