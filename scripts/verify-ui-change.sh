#!/usr/bin/env bash
# UI変更の検証1回分。修正と再試行の制御は ui-verification-loop が担う。
set -euo pipefail

TARGET_PAGE="${TARGET_PAGE:-}"
BASE="${BASE:-http://localhost:8080}"
RELATED_TESTS="${RELATED_TESTS:-tests/api/contract.test.js}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-90}"
SCREENSHOT_DIR="${SCREENSHOT_DIR:-artifacts/ui-verification}"

if [[ -z "$TARGET_PAGE" || "$TARGET_PAGE" == */* || "$TARGET_PAGE" == *".html" ]]; then
  echo "Usage: TARGET_PAGE=<page-name-without-.html> bash scripts/verify-ui-change.sh" >&2
  exit 2
fi

if [[ ! -f "web/${TARGET_PAGE}.html" ]]; then
  echo "Target page does not exist: web/${TARGET_PAGE}.html" >&2
  exit 2
fi

echo "[1/6] Start local dev stack"
# web の Nginx 設定が grafana を upstream として参照するため、両方を起動する。
docker compose up -d --build web grafana

echo "[2/6] Wait for ${BASE}/health"
for ((attempt = 1; attempt <= MAX_WAIT_SECONDS; attempt++)); do
  if curl -fsS "${BASE}/health" >/dev/null; then
    break
  fi
  if [[ "$attempt" -eq "$MAX_WAIT_SECONDS" ]]; then
    echo "Web health check did not become ready within ${MAX_WAIT_SECONDS}s" >&2
    exit 1
  fi
  sleep 1
done

echo "[3/6] Confirm target page"
status="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/${TARGET_PAGE}.html")"
if [[ "$status" != "200" ]]; then
  echo "Target page returned HTTP ${status}: ${BASE}/${TARGET_PAGE}.html" >&2
  exit 1
fi
echo "OK target page: ${BASE}/${TARGET_PAGE}.html"

echo "[4/6] Console errors must be zero"
PAGES="$TARGET_PAGE" BASE="$BASE" SCREENSHOT_DIR="$SCREENSHOT_DIR" node tests/smoke/console-check.js
echo "Screenshot: ${SCREENSHOT_DIR}/${TARGET_PAGE}.png"

echo "[5/6] HTTP smoke tests"
BASE="$BASE" bash tests/smoke/smoke.sh

echo "[6/6] Related API tests"
npm --prefix api run check:syntax
# shellcheck disable=SC2086
BASE="$BASE" node --test $RELATED_TESTS

echo "UI-VERIFY: PASS (${TARGET_PAGE})"
