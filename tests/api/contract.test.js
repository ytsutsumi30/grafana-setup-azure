/**
 * API コントラクトテスト(node:test 内蔵ランナー、外部依存なし)
 * 稼働中の docker スタック(web→api)に対して主要エンドポイントの
 * ステータスとレスポンス形状を検証する。Phase 3 のルーター分割の回帰ガード。
 *
 * 実行: docker compose up -d のうえで
 *   BASE=http://localhost:8080 node --test tests/api/contract.test.js
 *
 * 注意: 一部の契約テストはローカルDBに監査ログを追加する。
 * Azure公開URLや本番相当環境を BASE に指定しない。
 */
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:8080';
let authConfigPromise = null;

async function get(path) {
  const res = await fetch(BASE + path);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}
async function send(method, path, json, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: json === undefined ? undefined : JSON.stringify(json)
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, body };
}
function assertStatusIn(actual, expected, label) {
  assert.ok(expected.includes(actual), `${label}: expected one of ${expected.join(', ')}, got ${actual}`);
}
async function getAuthConfig() {
  if (!authConfigPromise) {
    authConfigPromise = get('/api/auth/m365/config').then((r) => (r.status === 200 ? r.body : { enabled: false, required: false }));
  }
  return authConfigPromise;
}

// --- ヘルス ---
test('health endpoints return 200', async () => {
  assert.equal((await get('/health')).status, 200);
  assert.equal((await get('/api/health')).status, 200);
});
test('M365 auth config endpoint is public', async () => {
  const r = await get('/api/auth/m365/config');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.enabled, 'boolean');
  assert.equal(typeof r.body.required, 'boolean');
});

// --- マスタ/一覧系(配列を返す) ---
const listEndpoints = [
  '/api/products',
  '/api/inspectors',
  '/api/inventory',
  '/api/production-plans',
  '/api/shipping-locations',
  '/api/delivery-locations',
  '/api/product-components',
  '/api/lot-inventory',
  '/api/inventory-counts',
  '/api/suppliers',
  '/api/purchase-orders',
  '/api/receiving-orders',
  '/api/sales-orders',
  '/api/manufacturing-orders',
  '/api/shipping-instructions',
  '/api/shipping-inspections',
  '/api/ocr-imports',
  '/api/new-qc/projects'
];
for (const ep of listEndpoints) {
  test(`GET ${ep} returns array or requires M365 sign-in`, async () => {
    const auth = await getAuthConfig();
    const r = await get(ep);
    if (auth.enabled && auth.required) {
      assert.equal(r.status, 401, `status for ${ep}`);
      return;
    }
    assert.equal(r.status, 200, `status for ${ep}`);
    assert.ok(Array.isArray(r.body), `${ep} should return an array`);
  });
}

test('shipping instruction list includes audit summary fields or requires M365 sign-in', async () => {
  const auth = await getAuthConfig();
  const r = await get('/api/shipping-instructions');
  if (auth.enabled && auth.required) {
    assert.equal(r.status, 401);
    return;
  }
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  if (r.body.length === 0) return;
  const row = r.body[0];
  assert.equal(typeof row.cancelled_scan_count, 'number');
  assert.equal(typeof row.post_completion_correction_count, 'number');
  assert.ok(Object.prototype.hasOwnProperty.call(row, 'last_shipping_audit_at'));
});

// --- 分離ルーターの代表(200) ---
const okEndpoints = [
  '/api/reports/dashboard-stats',
  '/api/reports/recent-inspections',
  '/api/qc-tools/pareto',
  '/api/monitoring/inventory-health',
  '/api/monitoring/dead-stock',
  '/api/monitoring/grafana-cloud/kpis',
  '/api/monitoring/grafana-cloud/backlog',
  '/api/monitoring/grafana-cloud/events-daily',
  '/api/monitoring/grafana-cloud/inventory-count-variance',
  '/api/traceability/search?q=REVIEW'
];
for (const ep of okEndpoints) {
  test(`GET ${ep} returns 200 or requires M365 sign-in`, async () => {
    const auth = await getAuthConfig();
    const r = await get(ep);
    assert.equal(r.status, auth.enabled && auth.required ? 401 : 200);
  });
}

// --- system-config: 形状 + PATCH で共有状態が変わる(直後に戻す) ---
test('system-config GET returns config object', async () => {
  const auth = await getAuthConfig();
  const r = await get('/api/system-config');
  if (auth.enabled && auth.required) {
    assert.equal(r.status, 401);
    return;
  }
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.pocMode, 'boolean');
  assert.equal(typeof r.body.enableQRInspectionDB, 'boolean');
});
test('system-config PATCH mutates shared state or is write-protected', async () => {
  const auth = await getAuthConfig();
  const beforeResponse = await get('/api/system-config');
  if (auth.enabled && auth.required) {
    assert.equal(beforeResponse.status, 401);
    return;
  }
  const before = beforeResponse.body.pocMode;
  const patched = await send('PATCH', '/api/system-config', { pocMode: !before });
  if (patched.status === 401) {
    return;
  }
  assert.equal(patched.status, 200);
  const now = (await get('/api/system-config')).body.pocMode;
  assert.equal(now, !before, 'pocMode should be toggled');
  // revert
  await send('PATCH', '/api/system-config', { pocMode: before });
  assert.equal((await get('/api/system-config')).body.pocMode, before);
});

test('shipment completion status returns completion guard shape or requires M365 sign-in', async () => {
  const auth = await getAuthConfig();
  const r = await get('/api/shipping-instructions/1/completion-status');
  if (auth.enabled && auth.required) {
    assert.equal(r.status, 401);
    return;
  }
  assertStatusIn(r.status, [200, 404], 'completion-status should be available when an instruction exists');
  if (r.status === 404) return;
  assert.equal(typeof r.body.can_complete, 'boolean');
  assert.equal(typeof r.body.already_completed, 'boolean');
  assert.ok(Array.isArray(r.body.blockers));
  assert.ok(Array.isArray(r.body.warnings));
});

test('shipping history returns nested workflow history or requires M365 sign-in', async () => {
  const auth = await getAuthConfig();
  const r = await get('/api/shipping-instructions/1/history');
  if (auth.enabled && auth.required) {
    assert.equal(r.status, 401);
    return;
  }
  assertStatusIn(r.status, [200, 404], 'shipping history should be available when an instruction exists');
  if (r.status === 404) return;
  assert.equal(typeof r.body.shipping, 'object');
  assert.ok(Array.isArray(r.body.lines));
  assert.ok(Array.isArray(r.body.allocations));
  assert.ok(Array.isArray(r.body.records));
  assert.ok(Array.isArray(r.body.audit_events));
});

test('inventory foundation endpoints return arrays or require M365 sign-in', async () => {
  const auth = await getAuthConfig();
  for (const ep of ['/api/inventory/balances', '/api/inventory/transactions']) {
    const r = await get(ep);
    if (auth.enabled && auth.required) {
      assert.equal(r.status, 401, `status for ${ep}`);
      continue;
    }
    assert.equal(r.status, 200, `status for ${ep}`);
    assert.ok(Array.isArray(r.body), `${ep} should return an array`);
  }
});

test('qr unit lookup returns details, 404, or requires M365 sign-in', async () => {
  const auth = await getAuthConfig();
  const r = await get('/api/qr-units/QR-REVIEW-P1-L1-A');
  if (auth.enabled && auth.required) {
    assert.equal(r.status, 401);
    return;
  }
  assertStatusIn(r.status, [200, 404], 'QR unit lookup should either find seeded review QR or return 404');
  if (r.status === 404) return;
  assert.equal(r.body.qr_code, 'QR-REVIEW-P1-L1-A');
  assert.equal(typeof r.body.product_code, 'string');
  assert.equal(typeof r.body.lot_number, 'string');
});

test('report event records next issue number or requires M365 sign-in', async () => {
  const auth = await getAuthConfig();
  if (auth.enabled && auth.required) {
    const protectedResponse = await send('POST', '/api/shipping-instructions/1/report-events', {
      report_type: 'inspection_result',
      output_method: 'html_print',
      revision_label: 'contract-test',
      comment: 'contract test'
    });
    assert.equal(protectedResponse.status, 401);
    return;
  }

  const before = await get('/api/shipping-instructions/1/history');
  assertStatusIn(before.status, [200, 404], 'shipping history should be available when an instruction exists');
  if (before.status === 404) return;

  const reportType = 'inspection_result';
  const existingIssueCount = before.body.audit_events.filter((event) =>
    event.event_type === 'report_printed' && event.after_data?.report_type === reportType
  ).length;
  const recorded = await send('POST', '/api/shipping-instructions/1/report-events', {
    report_type: reportType,
    output_method: 'html_print',
    revision_label: 'contract-test',
    comment: 'contract test'
  });
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.success, true);
  assert.equal(recorded.body.report_type, reportType);
  assert.equal(recorded.body.issue_number, existingIssueCount + 1);
  assert.equal(recorded.body.revision_label, 'contract-test');

  const after = await get('/api/shipping-instructions/1/history');
  assert.equal(after.status, 200);
  const matchingEvents = after.body.audit_events.filter((event) =>
    event.event_type === 'report_printed'
    && event.after_data?.report_type === reportType
    && event.after_data?.issue_number === existingIssueCount + 1
  );
  assert.ok(matchingEvents.length >= 1, 'history should include the recorded report issue');
});

// --- セキュリティ: 危険EPは未認証で 401/403(/api と ルートパス両方) ---
const dangerous = [
  ['GET', '/api/database/stats'],
  ['GET', '/api/database/backups'],
  ['GET', '/api/logs/files'],
  ['POST', '/api/database/restore'],
  ['POST', '/database/restore'], // nginx root-path プロキシ経由も遮断
  ['POST', '/api/qc-tools/generate-sample-data'],
  ['POST', '/api/monitoring/generate-sample-data']
];
for (const [method, ep] of dangerous) {
  test(`${method} ${ep} is protected`, async () => {
    const r = await send(method, ep, method === 'POST' ? {} : undefined);
    assertStatusIn(r.status, [401, 403], `${ep} should reject unauthenticated access`);
  });
}

// --- ADMIN_API_TOKEN 設定済みでも任意ヘッダでは拒否 ---
test('dangerous endpoint rejects arbitrary admin header', async () => {
  const r = await send('GET', '/api/database/backups', undefined, { 'x-admin-token': 'guess' });
  assertStatusIn(r.status, [401, 403], 'arbitrary admin header should be rejected');
});

// --- 404 ハンドラ ---
test('unknown route returns 404 JSON', async () => {
  const auth = await getAuthConfig();
  const r = await get('/api/no-such-endpoint-xyz');
  if (auth.enabled && auth.required) {
    assert.equal(r.status, 401);
    return;
  }
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'Route not found');
});
