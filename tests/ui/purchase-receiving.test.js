const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';

test('更新操作は二重送信を防ぎ、入庫数量と完了条件を制御する', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const consoleErrors = [];
  let completeRequests = 0;
  let scanRequests = 0;
  let purchaseCreateRequests = 0;
  let receivingCreateRequests = 0;
  const purchasePayloads = [];
  const scanPayloads = [];
  const successfulScanKeys = [];

  const details = {
    10: createDetail(10, 'RCV-INCOMPLETE', 'in_progress', 5, 3),
    20: createDetail(20, 'RCV-READY', 'in_progress', 5, 5),
    30: createDetail(30, 'RCV-COMPLETED', 'received', 5, 5)
  };

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/auth/m365/config') return json(route, { enabled: false, required: false });
    if (path === '/api/auth/whoami') return json(route, { authenticated: false });
    if (path === '/api/suppliers') return json(route, [{ id: 1, supplier_code: 'SUP001', supplier_name: 'テスト仕入先' }]);
    if (path === '/api/products') return json(route, [
      { id: 1, product_code: 'PROD001', product_name: '製品A' },
      { id: 2, product_code: 'PROD002', product_name: '製品B' }
    ]);
    if (path === '/api/purchase-orders' && method === 'GET') return json(route, []);
    if (path === '/api/purchase-orders' && method === 'POST') {
      purchaseCreateRequests += 1;
      purchasePayloads.push(request.postDataJSON());
      await delay(100);
      return json(route, { order: { id: 90 } });
    }
    if (path === '/api/purchase-orders/90/create-receiving-order' && method === 'POST') {
      receivingCreateRequests += 1;
      await delay(100);
      return json(route, { success: true, receiving_order: details[10].receiving_order });
    }
    if (path === '/api/receiving-orders' && method === 'GET') {
      return json(route, Object.values(details).map(({ receiving_order, lines }) => ({
        ...receiving_order,
        expected_quantity: lines[0].expected_quantity,
        received_quantity: lines[0].received_quantity
      })));
    }

    const match = path.match(/^\/api\/receiving-orders\/(\d+)$/);
    if (match && method === 'GET') return json(route, details[Number(match[1])]);
    if (path === '/api/receiving-orders/20/complete' && method === 'PATCH') {
      completeRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
      details[20].receiving_order.status = 'received';
      return json(route, { success: true, receiving_order: details[20].receiving_order });
    }
    if (path === '/api/receiving-orders/10/scan' && method === 'POST') {
      scanRequests += 1;
      successfulScanKeys.push(request.headers()['idempotency-key']);
      const payload = request.postDataJSON();
      scanPayloads.push(payload);
      await delay(100);
      details[10].lines[0].received_quantity += payload.received_quantity;
      details[10].lines[0].accepted_quantity += payload.accepted_quantity || 0;
      return json(route, { success: true });
    }
    return json(route, { error: `Unhandled mock API: ${method} ${path}` }, 404);
  });

  try {
    await page.goto(`${BASE}/purchase-receiving.html`, { waitUntil: 'networkidle' });

    await page.locator('#addPoLineButton').click();
    const lineRows = page.locator('#purchaseOrderLines [data-order-line]');
    await lineRows.nth(1).locator('[data-line-product]').selectOption('2');
    await lineRows.nth(1).locator('[data-line-quantity]').fill('4');
    assert.equal(await lineRows.nth(1).locator('label[for="poProduct-2"]').count(), 1);
    assert.equal(await lineRows.nth(1).locator('label[for="poQuantity-2"]').count(), 1);
    await page.waitForFunction(() => document.querySelector('#poLineSummary')?.textContent === '2品目 / 合計5');

    const purchaseResponse = page.waitForResponse((item) =>
      item.url().endsWith('/api/purchase-orders') && item.request().method() === 'POST');
    const receivingResponse = page.waitForResponse((item) =>
      item.url().endsWith('/api/purchase-orders/90/create-receiving-order'));
    await dispatchDoubleClick(page, '#createPoButton');
    await assertBusy(page, '#createPoButton', '登録中');
    await Promise.all([purchaseResponse, receivingResponse]);
    await page.waitForFunction(() => !document.querySelector('#createPoButton')?.hasAttribute('aria-busy'));
    assert.equal(purchaseCreateRequests, 1);
    assert.equal(receivingCreateRequests, 1);
    assert.deepEqual(purchasePayloads[0].lines, [
      { product_id: 1, ordered_quantity: 1 },
      { product_id: 2, ordered_quantity: 4 }
    ]);
    assert.equal(await page.locator('#createPoButton').isEnabled(), true);

    await page.locator('[data-receiving-id="10"]').click();
    await assertDisabledWithHint(page, '未入庫の明細が1件、残り2あります');
    assert.equal(await page.locator('#scanLine option').count(), 1);
    assert.equal(await page.locator('#scanQuantity').getAttribute('max'), '2');
    assert.equal(await page.locator('#scanQuantity').inputValue(), '2');
    await page.locator('#scanLot').fill('LOT-OVER');
    await page.locator('#scanQuantity').fill('3');
    await page.locator('#scanButton').click();
    await page.locator('.app-toast').filter({ hasText: '残入庫数量(2)を超えています' }).waitFor();
    assert.equal(scanRequests, 0);

    await page.locator('#scanLot').fill('LOT-FAIL');
    await page.locator('#scanQuantity').fill('1');
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      let rejectNextScan = true;
      window.fetch = (input, init) => {
        if (rejectNextScan && String(input).endsWith('/scan')) {
          rejectNextScan = false;
          window.__failedScanKey = init?.headers?.['Idempotency-Key'];
          return new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('テスト入庫失敗')), 100);
          });
        }
        return originalFetch(input, init);
      };
    });
    await dispatchDoubleClick(page, '#scanButton');
    await assertBusy(page, '#scanButton', '登録中');
    await page.screenshot({ path: 'artifacts/ui-verification/purchase-receiving-scan-busy-mobile.png', fullPage: true });
    await page.locator('.app-toast').filter({ hasText: 'テスト入庫失敗' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('#scanButton')?.hasAttribute('aria-busy'));
    assert.equal(scanRequests, 0);
    assert.equal(await page.locator('#scanButton').isEnabled(), true);
    assert.equal(await page.locator('#scanLot').inputValue(), 'LOT-FAIL');

    const successfulScanResponse = page.waitForResponse((item) =>
      item.url().endsWith('/api/receiving-orders/10/scan') && item.status() === 200);
    await dispatchDoubleClick(page, '#scanButton');
    await assertBusy(page, '#scanButton', '登録中');
    await successfulScanResponse;
    await page.waitForFunction(() => !document.querySelector('#scanButton')?.hasAttribute('aria-busy'));
    assert.equal(scanRequests, 1);
    assert.equal(successfulScanKeys[0], await page.evaluate(() => window.__failedScanKey));

    await page.locator('#scanLot').fill('LOT-REJECTED');
    await page.locator('#scanQuantity').fill('1');
    await page.locator('#scanStatus').selectOption('rejected');
    await page.locator('#scanButton').click();
    await page.locator('.app-toast').filter({ hasText: '理由分類を選択してください' }).waitFor();
    assert.equal(scanRequests, 1);
    await page.locator('#scanReason').selectOption('quality_issue');
    await page.locator('#scanComment').fill('外観検査で不良');
    const rejectedResponse = page.waitForResponse((item) =>
      item.url().endsWith('/api/receiving-orders/10/scan') && item.status() === 200);
    await page.locator('#scanButton').click();
    await rejectedResponse;
    assert.equal(scanRequests, 2);
    assert.equal(scanPayloads[1].inspection_status, 'rejected');
    assert.equal(scanPayloads[1].reason_code, 'quality_issue');
    assert.equal(scanPayloads[1].comment, '外観検査で不良');
    assert.equal(scanPayloads[1].rejected_quantity, 1);
    assert.equal(Object.hasOwn(scanPayloads[1], 'accepted_quantity'), false);

    await page.locator('[data-receiving-id="30"]').click();
    await assertDisabledWithHint(page, 'この入庫予定は完了済みです');
    assert.match(await page.locator('#completeReceivingButton').textContent(), /入庫完了済み/);
    assert.equal(await page.locator('#scanButton').isDisabled(), true);
    assert.equal(await page.locator('#scanLine option').count(), 0);
    assert.match(await page.locator('#scanAvailabilityHint').textContent(), /完了済み/);

    await page.locator('[data-receiving-id="20"]').click();
    await page.waitForFunction(() => !document.querySelector('#completeReceivingButton')?.disabled);
    assert.equal(await page.locator('#completeReceivingButton').isEnabled(), true);
    assert.match(await page.locator('#completeReceivingHint').textContent(), /全明細の入庫数量を確認済み/);
    assert.equal(await page.locator('#scanButton').isDisabled(), true);
    assert.match(await page.locator('#scanAvailabilityHint').textContent(), /全明細の入庫数量を登録済み/);

    await page.locator('#completeReceivingButton').click();
    await page.locator('#completeReceivingModal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#completeReceivingModal')).opacity === '1');
    assert.equal(completeRequests, 0);
    assert.equal(await page.locator('#completeReceivingOrderNo').textContent(), 'RCV-READY');
    await page.screenshot({ path: 'artifacts/ui-verification/purchase-receiving-confirm-mobile.png' });

    await page.locator('#cancelCompleteReceivingButton').click();
    await page.locator('#completeReceivingModal').waitFor({ state: 'hidden' });
    assert.equal(completeRequests, 0);

    await page.locator('#completeReceivingButton').click();
    await page.locator('#completeReceivingModal').waitFor({ state: 'visible' });
    const response = page.waitForResponse((item) => item.url().endsWith('/api/receiving-orders/20/complete'));
    await page.locator('#confirmCompleteReceivingButton').evaluate((button) => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await response;
    await page.waitForFunction(() => document.querySelector('#completeReceivingButton')?.textContent.includes('入庫完了済み'));
    assert.equal(completeRequests, 1);

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(horizontalOverflow <= 1, `mobile horizontal overflow: ${horizontalOverflow}px`);
    await page.screenshot({ path: 'artifacts/ui-verification/purchase-receiving-mobile.png', fullPage: true });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
  }
});

test('品目APIの障害時も発注一覧と入庫予定を保持する', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith('/api/products')) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'products unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        }));
      }
      return originalFetch(input, init);
    };
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/m365/config') return json(route, { enabled: false, required: false });
    if (url.pathname === '/api/auth/whoami') return json(route, { authenticated: false });
    if (url.pathname === '/api/suppliers') return json(route, [{ id: 1, supplier_code: 'SUP001', supplier_name: 'テスト仕入先' }]);
    if (url.pathname === '/api/purchase-orders') return json(route, [{ id: 1, purchase_order_no: 'PO-PARTIAL', status: 'ordered', supplier_name: 'テスト仕入先', line_count: 1 }]);
    if (url.pathname === '/api/receiving-orders') return json(route, [{ id: 10, receiving_order_no: 'RCV-PARTIAL', status: 'pending', supplier_name: 'テスト仕入先', expected_quantity: 5, received_quantity: 0 }]);
    return json(route, { error: `Unhandled mock API: ${url.pathname}` }, 404);
  });

  try {
    await page.goto(`${BASE}/purchase-receiving.html`, { waitUntil: 'networkidle' });
    await page.locator('#purchaseOrderList').filter({ hasText: 'PO-PARTIAL' }).waitFor();
    assert.match(await page.locator('#receivingOrderList').textContent(), /RCV-PARTIAL/);
    assert.equal(await page.locator('#createPoButton').isDisabled(), true);
    assert.equal(await page.locator('#poSupplier option').count(), 1);
    assert.equal(await page.locator('#poProduct option').count(), 0);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
  }
});

function createDetail(id, receivingOrderNo, status, expectedQuantity, receivedQuantity) {
  return {
    receiving_order: {
      id,
      receiving_order_no: receivingOrderNo,
      supplier_name: 'テスト仕入先',
      expected_date: '2026-07-24',
      status
    },
    lines: [{
      id: id * 10,
      product_code: 'PROD001',
      product_name: '製品A',
      expected_quantity: expectedQuantity,
      received_quantity: receivedQuantity,
      accepted_quantity: receivedQuantity,
      rejected_quantity: 0
    }],
    results: []
  };
}

async function assertDisabledWithHint(page, expectedHint) {
  try {
    await page.waitForFunction((expected) =>
      document.querySelector('#completeReceivingHint')?.textContent === expected, expectedHint);
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      hint: document.querySelector('#completeReceivingHint')?.textContent,
      detailClass: document.querySelector('#receivingDetail')?.className,
      selected: document.querySelector('[data-receiving-id].active')?.getAttribute('data-receiving-id')
    }));
    throw new Error(`${error.message}; state=${JSON.stringify(snapshot)}`);
  }
  assert.equal(await page.locator('#completeReceivingButton').isDisabled(), true);
  assert.equal(await page.locator('#completeReceivingHint').textContent(), expectedHint);
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
