# Azure Container Apps Deployment Notes

## Target architecture

- `web`: public Azure Container App running nginx and static files.
- `api`: internal Azure Container App running Node.js/Express.
- `web` proxies `/api/*` and legacy root API paths to `api` using `API_UPSTREAM`.
- Container images are built from `web/Dockerfile` and `api/Dockerfile`.
- Supabase is external and configured through Container Apps secrets.

## Initial settings

- Azure region: `japaneast`
- Use case: POC
- Grafana/Prometheus: deferred
- GCP Document AI: deferred
- API min replicas: 1
- Web min replicas: 1

## Required Azure parameters

`infra/main.bicep` requires these secure parameters at deployment time:

```text
supabaseDbHost
supabaseDbName
supabaseDbUser
supabaseDbPassword
```

Optional later:

```text
enableAwsTextract=true
awsAccessKeyId
awsSecretAccessKey
enableGcpDocumentAi=true
gcpProjectId
documentAiProcessorId
```

## Deployment choices

`azure.yaml` is prepared for Azure Developer CLI. `azd` was not installed in the scanned WSL environment, so install it before using `azd up`.

Alternative manual deployment can use Azure CLI:

```bash
az group create -n rg-shipping-inspection-poc -l japaneast
az deployment group create \
  -g rg-shipping-inspection-poc \
  -f infra/main.bicep \
  -p environmentName=shipping-inspection-poc \
  -p location=japaneast \
  -p supabaseDbHost='<host>' \
  -p supabaseDbName='postgres' \
  -p supabaseDbUser='postgres' \
  -p supabaseDbPassword='<password>'
```

After the first infrastructure deployment, build/push images and update the Container Apps with the real ACR images.

## Validation

Minimum checks:

```bash
curl https://<web-url>/health
curl https://<web-url>/api/health
curl https://<web-url>/api/db-test
curl https://<web-url>/api/products
```

## Current Deployment

Public web endpoint:

```text
https://shipping-inspection-poc-web.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

Internal API FQDN:

```text
shipping-inspection-poc-api.internal.lemonmushroom-c9d1cf36.japaneast.azurecontainerapps.io
```

The deployed app has been validated through `/health`, `/api/health`, `/api/db-test`, `/api/products`, `/api/shipping-instructions`, and `/api/inspectors`.
