# Terraform Status

Last updated: 2026-07-08

Terraform is the primary infrastructure deployment path for the Azure Container Apps + Supabase POC.

## Current Terraform Stack

Path:

```text
infra/terraform
```

Validation commands:

```bash
cd ~/grafana-setup-azure/infra/terraform
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

## Important Distinction

The original repository also contains `terraform/`, but that stack targets AWS EC2/RDS/Route53 and GCP Document AI.

For the Azure Container Apps + Supabase migration, use only:

```text
infra/terraform
```

## Azure Resources

The Azure Terraform stack creates and manages:

- Azure Resource Group
- Log Analytics Workspace
- Application Insights
- Azure Container Registry
- Azure Container Apps Environment
- Internal API Container App
- External Web Container App
- Managed Identity based ACR pull role assignments

## Current Deployment

Public web endpoint:

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

Current image tag:

```text
api-rate-limit-ci-20260707235426
```

Current revisions:

| App | Revision | Status |
|-----|----------|--------|
| `shipping-inspection-poc-api` | `shipping-inspection-poc-api--0000022` | `Running` |
| `shipping-inspection-poc-web` | `shipping-inspection-poc-web--0000024` | `Running` |

## Deployment Flow

1. Apply infrastructure changes with Terraform.
2. Build and publish images through Azure Container Registry.
3. Update Container Apps to the new image tag.

Commands:

```bash
cd ~/grafana-setup-azure/infra/terraform
terraform plan
terraform apply

cd ~/grafana-setup-azure
./scripts/deploy-images-terraform.sh
```

For traceable image tags:

```bash
IMAGE_TAG=<purpose>-$(date +%Y%m%d%H%M%S) ./scripts/deploy-images-terraform.sh
```
