/**
 * API コントラクトテスト(node:test 内蔵ランナー、外部依存なし)
 * 稼働中の docker スタック(web→api)に対して主要エンドポイントの
 * ステータスとレスポンス形状を検証する。Phase 3 のルーター分割の回帰ガード。
 *
 * 実行: docker compose up -d のうえで
 *   BASE=http://localhost:8080 node --test tests/api/contract.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.BASE || 'http://localhost:8080';

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

// --- ヘルス ---
test('health endpoints return 200', async () => {
  assert.equal((await get('/health')).status, 200);
  assert.equal((await get('/api/health')).status, 200);
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
  '/api/shipping-instructions',
  '/api/shipping-inspections',
  '/api/new-qc/projects'
];
for (const ep of listEndpoints) {
  test(`GET ${ep} returns 200 and array`, async () => {
    const r = await get(ep);
    assert.equal(r.status, 200, `status for ${ep}`);
    assert.ok(Array.isArray(r.body), `${ep} should return an array`);
  });
}

// --- 分離ルーターの代表(200) ---
const okEndpoints = [
  '/api/reports/dashboard-stats',
  '/api/reports/recent-inspections',
  '/api/qc-tools/pareto',
  '/api/monitoring/inventory-health',
  '/api/monitoring/dead-stock'
];
for (const ep of okEndpoints) {
  test(`GET ${ep} returns 200`, async () => {
    assert.equal((await get(ep)).status, 200);
  });
}

// --- system-config: 形状 + PATCH で共有状態が変わる(直後に戻す) ---
test('system-config GET returns config object', async () => {
  const r = await get('/api/system-config');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.pocMode, 'boolean');
  assert.equal(typeof r.body.enableQRInspectionDB, 'boolean');
});
test('system-config PATCH mutates shared state and reverts', async () => {
  const before = (await get('/api/system-config')).body.pocMode;
  const patched = await send('PATCH', '/api/system-config', { pocMode: !before });
  assert.equal(patched.status, 200);
  const now = (await get('/api/system-config')).body.pocMode;
  assert.equal(now, !before, 'pocMode should be toggled');
  // revert
  await send('PATCH', '/api/system-config', { pocMode: before });
  assert.equal((await get('/api/system-config')).body.pocMode, before);
});

// --- セキュリティ: 危険EPは admin 未設定で 403(/api と ルートパス両方) ---
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
  test(`${method} ${ep} is protected (403)`, async () => {
    const r = await send(method, ep, method === 'POST' ? {} : undefined);
    assert.equal(r.status, 403, `${ep} should be 403 without admin`);
  });
}

// --- ADMIN_API_TOKEN 未設定時、正しいヘッダでも既定403(トークン未構成) ---
test('dangerous endpoint stays 403 even with arbitrary admin header when unconfigured', async () => {
  const r = await send('GET', '/api/database/backups', undefined, { 'x-admin-token': 'guess' });
  assert.equal(r.status, 403);
});

// --- 404 ハンドラ ---
test('unknown route returns 404 JSON', async () => {
  const r = await get('/api/no-such-endpoint-xyz');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'Route not found');
});
