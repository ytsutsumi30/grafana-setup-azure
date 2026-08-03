const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';
const ARTIFACT_DIR = 'artifacts/ui-verification';

const balances = [
  { id: 1, product_id: 1, product_code: 'FG-1001', product_name: '駆動ユニット', lot_inventory_id: 101, lot_number: 'LOT-202607-A', qr_unit_id: 1001, qr_code: 'QR-FG-1001-A', location_code: 'A-1-01', location_name: '完成品棚 A-1-01', inventory_status: 'available', quantity: 20, last_transaction_id: 9001, updated_at: '2026-07-18T02:30:00Z' },
  { id: 2, product_id: 2, product_code: 'RM-2040', product_name: 'アルミハウジング', lot_inventory_id: 102, lot_number: 'LOT-202607-B', qr_unit_id: null, qr_code: null, location_code: 'B-2-03', location_name: '材料棚 B-2-03', inventory_status: 'reserved', quantity: 10, last_transaction_id: 9002, updated_at: '2026-07-18T01:20:00Z' },
  { id: 3, product_id: 3, product_code: 'RM-3050', product_name: '制御基板', lot_inventory_id: 103, lot_number: 'LOT-202607-C', qr_unit_id: 1003, qr_code: 'QR-RM-3050-C', location_code: 'Q-1-02', location_name: '品質保留棚 Q-1-02', inventory_status: 'on_hold', quantity: 4, last_transaction_id: 9003, updated_at: '2026-07-17T23:10:00Z' },
  { id: 4, product_id: 4, product_code: 'RM-4090', product_name: '不良モーター', lot_inventory_id: 104, lot_number: 'LOT-202607-D', qr_unit_id: null, qr_code: null, location_code: 'NG-1-01', location_name: '不良品棚 NG-1-01', inventory_status: 'defective', quantity: 2, last_transaction_id: 9004, updated_at: '2026-07-17T22:00:00Z' }
];

const transactions = [
  { id: 9003, transaction_type: 'adjustment', product_code: 'RM-3050', product_name: '制御基板', lot_number: 'LOT-202607-C', location_code: 'Q-1-02', quantity_delta: -1, occurred_at: '2026-07-18T02:28:00Z' },
  { id: 9002, transaction_type: 'issue', product_code: 'RM-2040', product_name: 'アルミハウジング', lot_number: 'LOT-202607-B', location_code: 'B-2-03', quantity_delta: -5, occurred_at: '2026-07-18T01:18:00Z' },
  { id: 9001, transaction_type: 'receipt', product_code: 'FG-1001', product_name: '駆動ユニット', lot_number: 'LOT-202607-A', location_code: 'A-1-01', quantity_delta: 20, occurred_at: '2026-07-18T00:45:00Z' }
];

test.before(() => fs.mkdirSync(ARTIFACT_DIR, { recursive: true }));

test('desktop inventory console supports filtering, sorting, details, QR lookup, and dark theme', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await mockApi(page);

  try {
    await page.goto(`${BASE}/inventory-foundation.html`, { waitUntil: 'networkidle' });
    await page.locator('#inventoryBalanceCount').filter({ hasText: '4件' }).waitFor();
    assert.equal(await page.locator('.inventory-kpi-value').first().textContent(), '36');
    assert.equal(await page.locator('.inventory-kpi.is-alert').count(), 1);
    assert.equal(await page.locator('.inventory-timeline-item').count(), 3);

    await page.locator('[data-inventory-status="on_hold"]').click();
    await page.locator('#inventoryBalanceCount').filter({ hasText: '1件' }).waitFor();
    assert.match(await page.locator('#inventoryBalanceBody').textContent(), /制御基板/);
    await page.locator('#inventoryClearFiltersButton').click();
    await page.locator('#inventoryBalanceCount').filter({ hasText: '4件' }).waitFor();

    await page.locator('[data-inventory-status="defective"]').click();
    await page.locator('#inventoryBalanceCount').filter({ hasText: '1件' }).waitFor();
    assert.match(await page.locator('#inventoryBalanceBody').textContent(), /不良モーター/);
    assert.match(await page.locator('#inventoryBalanceBody').textContent(), /不良/);
    await page.locator('#inventoryClearFiltersButton').click();
    await page.locator('#inventoryBalanceCount').filter({ hasText: '4件' }).waitFor();

    await page.locator('[data-inventory-sort="quantity"]').click();
    assert.equal(await page.locator('.inventory-balance-row .inventory-quantity').first().textContent(), '2');
    await page.locator('[data-inventory-sort="quantity"]').click();
    assert.equal(await page.locator('.inventory-balance-row .inventory-quantity').first().textContent(), '20');

    await page.locator('.inventory-balance-row .inventory-row-toggle').first().click();
    assert.equal(await page.locator('.inventory-detail-row').count(), 1);
    assert.match(await page.locator('.inventory-detail-row').textContent(), /最終トランザクション/);

    await page.locator('#qrLookupInput').fill('QR-FG-1001-A');
    await page.locator('#qrLookupInput').press('Enter');
    await page.locator('.inventory-qr-result-summary').waitFor();
    assert.match(await page.locator('#qrScannerStatus').textContent(), /照会成功/);
    assert.match(await page.locator('#qrLookupResult').textContent(), /駆動ユニット/);

    await page.locator('[data-theme-toggle]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.screenshot({ path: `${ARTIFACT_DIR}/inventory-foundation-desktop-dark.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('mobile inventory console uses cards without horizontal overflow', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await mockApi(page);

  try {
    await page.goto(`${BASE}/inventory-foundation.html`, { waitUntil: 'networkidle' });
    await page.locator('#inventoryBalanceCount').filter({ hasText: '4件' }).waitFor();
    assert.equal(await page.locator('.inventory-mobile-card').count(), 4);
    assert.equal(await page.locator('.inventory-table').isVisible(), false);
    assert.equal(await page.locator('.inventory-mobile-list').isVisible(), true);
    const buttonHeights = await page.locator('button:visible').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)));
    assert.ok(buttonHeights.every((height) => height >= 48), `touch targets: ${buttonHeights.join(', ')}`);
    assert.ok(await page.locator('#qrLookupButton').evaluate((button) => button.getBoundingClientRect().height >= 64));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `mobile horizontal overflow: ${overflow}px`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/inventory-foundation-mobile.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('transaction API failure preserves inventory balances and scopes the error', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes('/api/inventory/transactions')) {
        return Promise.resolve(new Response(JSON.stringify({ error: '在庫移動APIテスト障害' }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        }));
      }
      return originalFetch(input, init);
    };
  });
  await mockApi(page);

  try {
    await page.goto(`${BASE}/inventory-foundation.html`, { waitUntil: 'networkidle' });
    await page.locator('#inventoryBalanceCount').filter({ hasText: '4件' }).waitFor();
    assert.equal(await page.locator('.inventory-balance-row').count(), 4);
    assert.equal(await page.locator('.inventory-kpi-value').first().textContent(), '36');
    assert.match(await page.locator('#inventoryTransactionList').textContent(), /在庫移動を取得できませんでした/);
    assert.match(await page.locator('#inventoryLastUpdated').textContent(), /一部同期エラー/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('latest inventory and QR requests win when responses arrive out of order', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = collectErrors(page);

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/m365/config') return json(route, { enabled: false, required: false });
    if (url.pathname === '/api/auth/whoami') return json(route, { authenticated: false });
    if (url.pathname === '/api/inventory/transactions') return json(route, transactions);
    if (url.pathname === '/api/inventory/balances') {
      const lot = url.searchParams.get('lot_number');
      if (lot === 'SLOW') {
        await delay(180);
        return json(route, [{ ...balances[0], product_name: '旧い検索結果', lot_number: 'SLOW' }]);
      }
      if (lot === 'FAST') {
        await delay(20);
        return json(route, [{ ...balances[1], product_name: '最新の検索結果', lot_number: 'FAST' }]);
      }
      return json(route, balances);
    }
    if (url.pathname === '/api/qr-units/QR-SLOW') {
      await delay(180);
      return json(route, { ...balances[0], product_name: '旧いQR結果', qr_code: 'QR-SLOW' });
    }
    if (url.pathname === '/api/qr-units/QR-FAST') {
      await delay(20);
      return json(route, { ...balances[1], product_name: '最新のQR結果', qr_code: 'QR-FAST' });
    }
    return json(route, { error: `Unhandled mock API: ${url.pathname}` }, 404);
  });

  try {
    await page.goto(`${BASE}/inventory-foundation.html`, { waitUntil: 'networkidle' });
    await page.locator('#inventoryLotFilter').fill('SLOW');
    await page.locator('#inventoryLotFilter').press('Enter');
    await page.locator('#inventoryLotFilter').fill('FAST');
    await page.locator('#inventoryLotFilter').press('Enter');
    await page.locator('#inventoryBalanceBody').filter({ hasText: '最新の検索結果' }).waitFor();
    await delay(250);
    assert.doesNotMatch(await page.locator('#inventoryBalanceBody').textContent(), /旧い検索結果/);

    await page.locator('#qrLookupInput').fill('QR-SLOW');
    await page.locator('#qrLookupInput').press('Enter');
    await page.locator('#qrLookupInput').fill('QR-FAST');
    await page.locator('#qrLookupInput').press('Enter');
    await page.locator('#qrLookupResult').filter({ hasText: '最新のQR結果' }).waitFor();
    await delay(250);
    assert.doesNotMatch(await page.locator('#qrLookupResult').textContent(), /旧いQR結果/);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

function collectErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function mockApi(page, options = {}) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/m365/config') return json(route, { enabled: false, required: false });
    if (url.pathname === '/api/auth/whoami') return json(route, { authenticated: false });
    if (url.pathname === '/api/inventory/balances') {
      const status = url.searchParams.get('inventory_status');
      const lot = url.searchParams.get('lot_number');
      const location = url.searchParams.get('location_code');
      const rows = balances.filter((row) => (!status || row.inventory_status === status)
        && (!lot || row.lot_number.includes(lot))
        && (!location || row.location_code === location));
      return json(route, rows);
    }
    if (url.pathname === '/api/inventory/transactions') {
      if (options.failTransactions) return json(route, { error: '在庫移動APIテスト障害' }, 500);
      return json(route, transactions);
    }
    if (url.pathname === '/api/qr-units/QR-FG-1001-A') {
      return json(route, { ...balances[0], balance_quantity: balances[0].quantity, current_location_code: balances[0].location_code });
    }
    return json(route, { error: `Unhandled mock API: ${request.method()} ${url.pathname}` }, 404);
  });
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
