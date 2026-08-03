#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infra/terraform"
MIGRATIONS=(
  "$ROOT/postgres/migrations/20260707_shipping_audit_events.sql"
  "$ROOT/postgres/migrations/20260707_qr_units.sql"
  "$ROOT/postgres/migrations/20260708_inventory_foundation.sql"
  "$ROOT/postgres/migrations/20260708_purchase_receiving.sql"
  "$ROOT/postgres/migrations/20260708_sales_order_shipping.sql"
  "$ROOT/postgres/migrations/20260708_inventory_count.sql"
  "$ROOT/postgres/migrations/20260708_ocr_imports.sql"
  "$ROOT/postgres/migrations/20260711_ocr_feedback.sql"
  "$ROOT/postgres/migrations/20260708_manufacturing_orders.sql"
  "$ROOT/postgres/migrations/20260718_inventory_ledger_integrity.sql"
)

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the Supabase Session Pooler connection string before deployment.}"

ACR_NAME="$(terraform -chdir="$TF_DIR" output -raw acr_name)"
ACR_SERVER="$(terraform -chdir="$TF_DIR" output -raw acr_login_server)"
RG_NAME="$(terraform -chdir="$TF_DIR" output -raw resource_group_name)"
API_APP="$(terraform -chdir="$TF_DIR" output -raw api_container_app_name)"
WEB_APP="$(terraform -chdir="$TF_DIR" output -raw web_container_app_name)"
WEB_URL="$(terraform -chdir="$TF_DIR" output -raw web_url)"

azure_cli_path() {
  local path="$1"
  if command -v wslpath >/dev/null 2>&1 && [[ "$(command -v az)" == /mnt/* ]]; then
    wslpath -w "$path"
  else
    printf '%s\n' "$path"
  fi
}

API_BUILD_CONTEXT="$(azure_cli_path "$ROOT/api")"
WEB_BUILD_CONTEXT="$(azure_cli_path "$ROOT/web")"

OLD_API_IMAGE="$(az containerapp show --name "$API_APP" --resource-group "$RG_NAME" --query 'properties.template.containers[0].image' -o tsv)"
OLD_WEB_IMAGE="$(az containerapp show --name "$WEB_APP" --resource-group "$RG_NAME" --query 'properties.template.containers[0].image' -o tsv)"
UPDATED_API=false
UPDATED_WEB=false

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Deployment failed. Restoring previous Container Apps images..." >&2
  if [ "$UPDATED_API" = true ] && [ -n "$OLD_API_IMAGE" ]; then
    az containerapp update --name "$API_APP" --resource-group "$RG_NAME" --image "$OLD_API_IMAGE" >/dev/null || true
  fi
  if [ "$UPDATED_WEB" = true ] && [ -n "$OLD_WEB_IMAGE" ]; then
    az containerapp update --name "$WEB_APP" --resource-group "$RG_NAME" --image "$OLD_WEB_IMAGE" >/dev/null || true
  fi
  exit "$exit_code"
}

wait_for_revision() {
  local app_name="$1"
  local latest=""
  local ready=""
  for _ in $(seq 1 60); do
    latest="$(az containerapp show --name "$app_name" --resource-group "$RG_NAME" --query properties.latestRevisionName -o tsv)"
    ready="$(az containerapp show --name "$app_name" --resource-group "$RG_NAME" --query properties.latestReadyRevisionName -o tsv)"
    if [ -n "$latest" ] && [ "$latest" = "$ready" ]; then
      return 0
    fi
    sleep 5
  done
  echo "Latest revision did not become ready: $app_name (latest=$latest, ready=$ready)" >&2
  return 1
}

trap rollback ERR

IMAGE_TAG="${IMAGE_TAG:-$(date +%Y%m%d%H%M%S)}"
API_IMAGE="shipping-inspection-api:${IMAGE_TAG}"
WEB_IMAGE="shipping-inspection-web:${IMAGE_TAG}"

echo "Applying required Supabase migrations..."
for migration in "${MIGRATIONS[@]}"; do
  "$ROOT/scripts/apply-supabase-migration.sh" "$migration"
done

echo "Building API image in ACR..."
az acr build --registry "$ACR_NAME" --image "$API_IMAGE" "$API_BUILD_CONTEXT"

echo "Building Web image in ACR..."
az acr build --registry "$ACR_NAME" --image "$WEB_IMAGE" "$WEB_BUILD_CONTEXT"

echo "Configuring Container Apps registry access with managed identity..."
az containerapp registry set --name "$API_APP" --resource-group "$RG_NAME" --server "$ACR_SERVER" --identity system
az containerapp registry set --name "$WEB_APP" --resource-group "$RG_NAME" --server "$ACR_SERVER" --identity system

echo "Updating Container Apps images..."
UPDATED_API=true
az containerapp update --name "$API_APP" --resource-group "$RG_NAME" --image "$ACR_SERVER/$API_IMAGE"
wait_for_revision "$API_APP"
UPDATED_WEB=true
az containerapp update --name "$WEB_APP" --resource-group "$RG_NAME" --image "$ACR_SERVER/$WEB_IMAGE"
wait_for_revision "$WEB_APP"

echo "Checking public application health..."
for _ in $(seq 1 60); do
  if curl -fsS "$WEB_URL/api/health" >/dev/null; then
    break
  fi
  sleep 5
done
curl -fsS "$WEB_URL/api/health" >/dev/null

echo "Deployment complete."
printf '%s\n' "$WEB_URL"
