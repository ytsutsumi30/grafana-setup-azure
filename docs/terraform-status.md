# Terraform Status

Terraform is now the primary deployment path.

## Current Terraform stack

Path: infra/terraform

Validated with:

`ash
cd ~/grafana-setup-azure/infra/terraform
terraform fmt -recursive
terraform init -backend=false
terraform validate
`

Result: valid.

## Important distinction

The original source repository contains `terraform/`, but that stack targets AWS EC2/RDS/Route53 and GCP Document AI. It is not used for the Azure Container Apps + Supabase migration.

The new Azure stack is under infra/terraform and creates:

- Azure Resource Group
- Log Analytics Workspace
- Application Insights
- Azure Container Registry
- Azure Container Apps Environment
- Internal pi Container App
- External web Container App
- Managed Identity based ACR pull role assignments

## Deployment flow

1. Apply Terraform infrastructure with placeholder images.
2. Run scripts/deploy-images-terraform.sh to build images in ACR and update Container Apps.


## Current Endpoint

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```
