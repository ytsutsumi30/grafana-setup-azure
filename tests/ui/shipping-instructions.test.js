const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';

test('出荷状態を工程操作に限定し、モバイル一覧と保存の二重送信を制御する', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const consoleErrors = [];
  const updatePayloads = [];
  let updateRequests = 0;

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const instructions = [
    createInstruction(1, 'SHP-PENDING', 'pending'),
    createInstruction(2, 'SHP-COMPLETE', 'shipped')
  ];

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/auth/m365/config') return json(route, { enabled: false, required: false });
    if (path === '/api/auth/whoami') return json(route, { authenticated: false });
    if (path === '/api/products') return json(route, [{ id: 1, product_code: 'PROD001', product_name: '製品A' }]);
    if (path === '/api/shipping-locations') return json(route, [{ id: 1, location_code: 'WH-A', location_name: '倉庫A' }]);
    if (path === '/api/delivery-locations') return json(route, [{ id: 1, location_code: 'DEST-A', location_name: '配送先A' }]);
    if (path === '/api/shipping-instructions' && method === 'GET') return json(route, instructions);
    if (path === '/api/shipping-instructions/1' && method === 'GET') return json(route, instructions[0]);
    if (path === '/api/shipping-instructions/1' && method === 'PUT') {
      updateRequests += 1;
      updatePayloads.push(request.postDataJSON());
      await delay(100);
      return json(route, request.postDataJSON());
    }
    if (/^\/api\/shipping-instructions\/\d+\/progress$/.test(path)) {
      return json(route, { line_count: 2, completed_lines: 1, total_quantity: 5, shipped_quantity: 2, percent: 40, status: 'partial' });
    }
    return json(route, { error: `Unhandled mock API: ${method} ${path}` }, 404);
  });

  try {
    await page.goto(`${BASE}/shipping-instructions.html`, { waitUntil: 'networkidle' });
    await page.locator('.app-header').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-layout'), 'auto');
    assert.equal(await page.locator('#status').getAttribute('type'), 'hidden');
    assert.equal(await page.locator('#instructionsMobileList .shipping-mobile-item').count(), 2);

    const pendingItem = page.locator('.shipping-mobile-item').filter({ hasText: 'SHP-PENDING' });
    const completedItem = page.locator('.shipping-mobile-item').filter({ hasText: 'SHP-COMPLETE' });
    assert.equal(await pendingItem.locator('[data-action="edit"]').count(), 1);
    assert.equal(await pendingItem.locator('a[href*="shipping-quantity.html"]').count(), 1);
    assert.equal(await completedItem.locator('[data-action="edit"]').count(), 0);
    assert.equal(await completedItem.locator('[data-action="delete"]').count(), 0);
    assert.equal(await completedItem.locator('a[href*="shipping-quantity.html"]').count(), 0);

    await pendingItem.locator('[data-action="edit"]').click();
    await page.locator('#instructionModal').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#productId').isDisabled(), true);
    assert.equal(await page.locator('#quantity').isDisabled(), true);
    assert.equal(await page.locator('#statusDisplay').textContent(), '未処理');

    const response = page.waitForResponse((item) =>
      item.url().endsWith('/api/shipping-instructions/1') && item.request().method() === 'PUT');
    await dispatchDoubleClick(page, '#saveInstructionButton');
    await assertBusy(page, '#saveInstructionButton', '保存中');
    await response;
    await page.waitForFunction(() => !document.querySelector('#saveInstructionButton')?.hasAttribute('aria-busy'));
    assert.equal(updateRequests, 1);
    assert.equal(Object.hasOwn(updatePayloads[0], 'status'), false);

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(horizontalOverflow <= 1, `mobile horizontal overflow: ${horizontalOverflow}px`);
    await page.screenshot({ path: 'artifacts/ui-verification/shipping-instructions-mobile.png', fullPage: true });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
  }
});

function createInstruction(id, instructionId, status) {
  return {
    id,
    instruction_id: instructionId,
    product_id: 1,
    product_code: 'PROD001',
    product_name: '製品A',
    quantity: 5,
    shipping_date: '2026-08-04',
    shipping_location_id: 1,
    shipping_location_code: 'WH-A',
    delivery_location_id: 1,
    delivery_location_code: 'DEST-A',
    customer_name: '顧客A',
    priority: 'normal',
    status,
    tracking_number: '',
    notes: '',
    cancelled_scan_count: 0,
    post_completion_correction_count: 0
  };
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function dispatchDoubleClick(page, selector) {
  await page.locator(selector).evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function assertBusy(page, selector, label) {
  const button = page.locator(selector);
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.getAttribute('aria-busy'), 'true');
  assert.match(await button.textContent(), new RegExp(label));
}
