# Terraform Deployment

## Current Endpoint

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```


This is now the primary deployment path.

## Files

- `infra/terraform/versions.tf`
- `infra/terraform/variables.tf`
- `infra/terraform/main.tf`
- `infra/terraform/outputs.tf`
- `infra/terraform/terraform.tfvars.example`
- `scripts/deploy-images-terraform.sh`

The old source `terraform/` directory was AWS-specific and is not used.

## 1. Prepare variables

```bash
cd ~/grafana-setup-azure/infra/terraform
cp terraform.tfvars.example terraform.tfvars
vi terraform.tfvars
```

For the current Supabase project and IPv4-compatible pooler, use:

```hcl
supabase_db_host = "aws-0-ap-northeast-1.pooler.supabase.com"
supabase_db_user = "postgres.ffhgeppjrcylrufcqbep"
```

Set `supabase_db_password` to the DB password used when creating the Supabase project.

## 2. Deploy Azure infrastructure

```bash
terraform init
terraform plan
terraform apply
```

Terraform creates placeholder Container Apps first. This avoids failing on ACR images that do not exist yet.

## 3. Build and deploy images

```bash
cd ~/grafana-setup-azure
./scripts/deploy-images-terraform.sh
```

This script builds images in ACR, configures managed identity registry access, and updates both Container Apps.

## 4. Validate

```bash
WEB_URL="https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io"
curl "$WEB_URL/health"
curl "$WEB_URL/api/health"
curl "$WEB_URL/api/products"
```

## Deferred items

- Grafana/Prometheus remain deferred.
- GCP Document AI remains deferred. See `docs/gcp-document-ai-deferred-plan.md`.
## Supabase pooler correction

If the administrator-authenticated `/api/db-test` returns `tenant/user ... not found`, copy the **Session pooler** connection string from Supabase Dashboard > Connect and run:

`ash
cd ~/grafana-setup-azure
export SUPABASE_DB_URL='postgresql://...'
./scripts/set-supabase-terraform-vars.sh
cd infra/terraform
terraform apply
`

Then restart/update the API app if Terraform changes secrets.
