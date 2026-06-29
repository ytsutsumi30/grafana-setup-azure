#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN to a Supabase personal access token.}"
: "${SUPABASE_ORG_ID:?Set SUPABASE_ORG_ID to the target Supabase organization ID.}"
: "${SUPABASE_DB_PASSWORD:?Set SUPABASE_DB_PASSWORD for the new project database.}"

PROJECT_NAME="${SUPABASE_PROJECT_NAME:-shipping-inspection-poc}"
REGION="${SUPABASE_REGION:-ap-northeast-1}"
OUT_FILE="${SUPABASE_PROJECT_RESPONSE_FILE:-supabase-project.json}"

payload=$(jq -n \
  --arg name "$PROJECT_NAME" \
  --arg organization_id "$SUPABASE_ORG_ID" \
  --arg db_pass "$SUPABASE_DB_PASSWORD" \
  --arg region "$REGION" \
  '{name:$name, organization_id:$organization_id, db_pass:$db_pass, region:$region}')

curl -fsS -X POST "https://api.supabase.com/v1/projects" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$payload" \
  -o "$OUT_FILE"

echo "Supabase project create request submitted. Response saved to ${OUT_FILE}."
cat "$OUT_FILE" | jq .