#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform"

ACR_NAME="$(terraform -chdir="$TF_DIR" output -raw acr_name)"
ACR_SERVER="$(terraform -chdir="$TF_DIR" output -raw acr_login_server)"
RG_NAME="$(terraform -chdir="$TF_DIR" output -raw resource_group_name)"
API_APP="$(terraform -chdir="$TF_DIR" output -raw api_container_app_name)"
WEB_APP="$(terraform -chdir="$TF_DIR" output -raw web_container_app_name)"

IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
API_IMAGE="shipping-inspection-api:${IMAGE_TAG}"
WEB_IMAGE="shipping-inspection-web:${IMAGE_TAG}"

echo "Building API image in ACR..."
az acr build --registry "$ACR_NAME" --image "$API_IMAGE" "$ROOT/api"

echo "Building Web image in ACR..."
az acr build --registry "$ACR_NAME" --image "$WEB_IMAGE" "$ROOT/web"

echo "Configuring Container Apps registry access with managed identity..."
az containerapp registry set --name "$API_APP" --resource-group "$RG_NAME" --server "$ACR_SERVER" --identity system
az containerapp registry set --name "$WEB_APP" --resource-group "$RG_NAME" --server "$ACR_SERVER" --identity system

echo "Updating Container Apps images..."
az containerapp update --name "$API_APP" --resource-group "$RG_NAME" --image "$ACR_SERVER/$API_IMAGE"
az containerapp update --name "$WEB_APP" --resource-group "$RG_NAME" --image "$ACR_SERVER/$WEB_IMAGE"

echo "Deployment complete."
terraform -chdir="$TF_DIR" output web_url