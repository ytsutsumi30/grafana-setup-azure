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
chk_any() { # chk_any <expected_csv> <method> <path> [data]
  local expected_csv="$1" method="$2" p="$3" data="${4:-}"
  local code
  if [ "$method" = "GET" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$p")
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$data" "$BASE$p")
  fi
  case ",$expected_csv," in
    *",$code,"*) printf "  OK   %-4s %-45s -> %s\n" "$method" "$p" "$code" ;;
    *) printf "  FAIL %-4s %-45s -> %s (expected one of %s)\n" "$method" "$p" "$code" "$expected_csv"; fail=1 ;;
  esac
}

echo "[1] API 健全性"
chk 200 GET /health
chk 200 GET /api/health
chk 200 GET /api/auth/m365/config

echo "[2] 本番ページ = 200"
for p in index database delivery-locations inspectors inventory maintenance monitoring \
         pps product-components production-plans products qc-analysis qc-dashboard \
         qr-inspection3 qr-inspection ocr-v2-enhanced shipping-quantity shipping-instructions shipping-instruction-detail \
         shipping-history shipping-report shipping-locations system-config traceability inventory-foundation purchase-receiving sales-shipping; do
  chk 200 GET "/$p.html"
done

echo "[3] 本番JS資産 = 200"
for j in index-app qr-scanner qr-scanner-worker.min m365-auth monitoring-dashboard new-qc-analysis qc-dashboard pages/shipping-history pages/shipping-instructions pages/shipping-quantity pages/shipping-locations pages/delivery-locations pages/inspectors pages/production-plans pages/product-components pages/shipping-report pages/shipping-instruction-detail pages/traceability pages/inventory-foundation pages/purchase-receiving pages/sales-shipping; do
  chk 200 GET "/js/$j.js"
done
chk 200 GET /css/pages/shipping-report.css
chk 200 GET /css/pages/shipping-instructions.css
chk 200 GET /css/pages/shipping-quantity.css
chk 200 GET /css/pages/shipping-locations.css
chk 200 GET /css/pages/delivery-locations.css
chk 200 GET /css/pages/inspectors.css
chk 200 GET /css/pages/production-plans.css
chk 200 GET /css/pages/product-components.css
chk 200 GET /css/pages/shipping-instruction-detail.css
chk 200 GET /css/pages/traceability.css
chk 200 GET /css/pages/inventory-foundation.css
chk 200 GET /css/pages/purchase-receiving.css
chk 200 GET /css/pages/sales-shipping.css

echo "[4] 退避ページ = 404 (整理後に有効)"
for p in safari qr-inspection2 index-org camera-test order; do
  chk 404 GET "/$p.html"
done

echo "[4b] 分離ルーターの疎通またはM365必須保護(200/401)"
chk_any 200,401 GET /api/reports/dashboard-stats
chk_any 200,401 GET /api/reports/recent-inspections
chk_any 200,401 GET /api/production-plans
chk_any 200,401 GET /api/inventory
chk_any 200,401 GET /api/inspectors
chk_any 200,401 GET /api/new-qc/projects
chk_any 200,401 GET /api/qc-tools/pareto
chk_any 200,401 GET /api/monitoring/inventory-health
chk_any 200,401 GET /api/shipping-instructions/1/lines
chk_any 200,401,404 GET /api/shipping-instructions/1/history
chk_any 200,401 GET /api/products
chk_any 200,401 GET /api/shipping-instructions
chk_any 200,401 GET /api/shipping-inspections
chk_any 200,401 GET /api/system-config
chk_any 200,401 GET /api/traceability/search?q=REVIEW

echo "[5] 危険EPは保護継続(401/403)"
chk_any 401,403 GET  /api/database/backups
chk_any 401,403 POST /api/database/restore '{"sql":"SELECT 1"}'

echo "[6] 更新系APIは公開環境で未認証拒否(401)またはローカルPOCで許可(200)"
chk_any 200,401 PATCH /api/system-config '{"pocMode":true}'

echo
if [ "$fail" = "0" ]; then echo "SMOKE: ALL PASS"; else echo "SMOKE: FAILURES DETECTED"; fi
exit $fail
