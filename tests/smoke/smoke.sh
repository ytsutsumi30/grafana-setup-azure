#!/usr/bin/env bash
# Phase 1 スモークテスト: ページ整理の回帰ガード。
# 本番ページ/資産が 200、退避ページが 404(整理後)、危険EPが 403、API健全を確認する。
# 使い方: BASE=http://localhost:8080 bash tests/smoke/smoke.sh
set -u
BASE="${BASE:-http://localhost:8080}"
fail=0
chk() { # chk <expected> <method> <path> [data]
  local exp="$1" method="$2" p="$3" data="${4:-}"
  local code
  if [ "$method" = "GET" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$p")
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$data" "$BASE$p")
  fi
  if [ "$code" = "$exp" ]; then
    printf "  OK   %-4s %-45s -> %s\n" "$method" "$p" "$code"
  else
    printf "  FAIL %-4s %-45s -> %s (expected %s)\n" "$method" "$p" "$code" "$exp"
    fail=1
  fi
}

echo "[1] API 健全性"
chk 200 GET /health
chk 200 GET /api/health

echo "[2] 本番ページ(17) = 200"
for p in index database delivery-locations inspectors inventory maintenance monitoring \
         pps product-components production-plans products qc-analysis qc-dashboard \
         qr-inspection3 shipping-instructions shipping-locations system-config; do
  chk 200 GET "/$p.html"
done

echo "[3] 本番JS資産 = 200"
for j in index-app qr-scanner qr-scanner-worker.min m365-auth monitoring-dashboard new-qc-analysis qc-dashboard; do
  chk 200 GET "/js/$j.js"
done

echo "[4] 退避ページ = 404 (整理後に有効)"
for p in safari qr-inspection index-org camera-test order; do
  chk 404 GET "/$p.html"
done

echo "[4b] 分離ルーターの疎通(200)"
chk 200 GET /api/reports/dashboard-stats
chk 200 GET /api/reports/recent-inspections

echo "[5] 危険EPは保護継続(403)"
chk 403 GET  /api/database/backups
chk 403 POST /api/database/restore '{"sql":"SELECT 1"}'

echo
if [ "$fail" = "0" ]; then echo "SMOKE: ALL PASS"; else echo "SMOKE: FAILURES DETECTED"; fi
exit $fail
