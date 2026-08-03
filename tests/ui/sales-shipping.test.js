const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';

test('複数品目受注、二重送信防止、詳細取得失敗時の旧表示消去', { timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const consoleErrors = [];
  const salesPayloads = [];
  let salesCreateRequests = 0;
  let shippingCreateRequests = 0;

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
    if (path === '/api/products') return json(route, [
      { id: 1, product_code: 'PROD001', product_name: '製品A', available_stock: 20 },
      { id: 2, product_code: 'PROD002', product_name: '製品B', available_stock: 10 }
    ]);
    if (path === '/api/sales-orders' && method === 'GET') {
      return json(route, [
        { id: 10, sales_order_no: 'SO-GOOD', customer_name: '顧客A', status: 'confirmed', ordered_quantity: 5, shipped_quantity: 0, shipping_instruction_count: 0 },
        { id: 20, sales_order_no: 'SO-ERROR', customer_name: '顧客B', status: 'confirmed', ordered_quantity: 2, shipped_quantity: 0, shipping_instruction_count: 0 }
      ]);
    }
    if (path === '/api/sales-orders' && method === 'POST') {
      salesCreateRequests += 1;
      salesPayloads.push(request.postDataJSON());
      await delay(100);
      return json(route, { order: { id: 10 } }, 201);
    }
    if (path === '/api/sales-orders/10' && method === 'GET') {
      return json(route, {
        order: { id: 10, sales_order_no: 'SO-GOOD', customer_name: '顧客A', status: 'confirmed', requested_ship_date: '2026-08-04', priority: 'normal' },
        lines: [
          { id: 101, product_code: 'PROD001', product_name: '製品A', ordered_quantity: 2, shipped_quantity: 0 },
          { id: 102, product_code: 'PROD002', product_name: '製品B', ordered_quantity: 3, shipped_quantity: 0 }
        ],
        shipping_instructions: shippingCreateRequests ? [{ id: 50, instruction_id: 'SHP-SO-GOOD', status: 'pending', shipping_date: '2026-08-04' }] : []
      });
    }
    if (path === '/api/sales-orders/10/create-shipping-instruction' && method === 'POST') {
      shippingCreateRequests += 1;
      await delay(100);
      return json(route, { shipping_instruction: { id: 50 }, existing: false }, 201);
    }
    return json(route, { error: `Unhandled mock API: ${method} ${path}` }, 404);
  });

  try {
    await page.goto(`${BASE}/sales-shipping.html`, { waitUntil: 'networkidle' });

    await page.locator('#addSalesLineButton').click();
    const lineRows = page.locator('#salesOrderLines [data-order-line]');
    await lineRows.nth(1).locator('[data-line-product]').selectOption('2');
    await lineRows.nth(1).locator('[data-line-quantity]').fill('3');
    assert.equal(await lineRows.nth(1).locator('label[for="salesProduct-2"]').count(), 1);
    assert.equal(await lineRows.nth(1).locator('label[for="salesQuantity-2"]').count(), 1);
    await lineRows.nth(0).locator('[data-line-quantity]').fill('2');
    await page.waitForFunction(() => document.querySelector('#salesLineSummary')?.textContent === '2品目 / 合計5');

    const salesResponse = page.waitForResponse((item) =>
      item.url().endsWith('/api/sales-orders') && item.request().method() === 'POST');
    await dispatchDoubleClick(page, '#createSalesOrderButton');
    await assertBusy(page, '#createSalesOrderButton', '登録中');
    await salesResponse;
    await page.waitForFunction(() => !document.querySelector('#createSalesOrderButton')?.hasAttribute('aria-busy'));
    assert.equal(salesCreateRequests, 1);
    assert.deepEqual(salesPayloads[0].lines, [
      { product_id: 1, ordered_quantity: 2 },
      { product_id: 2, ordered_quantity: 3 }
    ]);
    assert.equal(await page.locator('#salesOrderLines [data-order-line]').count(), 1);

    await page.locator('[data-sales-id="10"]').click();
    await page.locator('#salesTitle').filter({ hasText: 'SO-GOOD' }).waitFor();
    const shippingResponse = page.waitForResponse((item) => item.url().endsWith('/create-shipping-instruction'));
    await dispatchDoubleClick(page, '#createShippingButton');
    await assertBusy(page, '#createShippingButton', '生成中');
    await shippingResponse;
    await page.waitForFunction(() => !document.querySelector('#createShippingButton')?.hasAttribute('aria-busy'));
    assert.equal(shippingCreateRequests, 1);

    await page.evaluate(() => {
      const originalFetch = window.fetch;
      let rejectNextProducts = true;
      window.fetch = (input, init) => {
        if (rejectNextProducts && String(input).endsWith('/api/products')) {
          rejectNextProducts = false;
          return Promise.reject(new Error('master unavailable'));
        }
        return originalFetch(input, init);
      };
    });
    await page.locator('#reloadButton').click();
    await page.locator('#salesDetailState').filter({ hasText: 'master unavailable' }).waitFor();
    assert.equal(await page.locator('#salesDetail').isHidden(), true);
    assert.equal(await page.locator('#createSalesOrderButton').isDisabled(), true);
    assert.equal(await page.locator('#createShippingButton').isDisabled(), true);

    await page.locator('#reloadButton').click();
    await page.locator('[data-sales-id="20"]').waitFor();

    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = (input, init) => {
        if (String(input).endsWith('/api/sales-orders/20')) {
          return new Promise((resolve, reject) => setTimeout(() => reject(new Error('detail unavailable')), 120));
        }
        return originalFetch(input, init);
      };
    });
    await page.locator('[data-sales-id="20"]').click();
    await page.locator('#salesDetailState').filter({ hasText: '読み込んでいます' }).waitFor();
    assert.equal(await page.locator('#salesDetail').isHidden(), true);
    await page.locator('#salesDetailState').filter({ hasText: 'detail unavailable' }).waitFor();
    assert.equal(await page.locator('#salesDetail').isHidden(), true);
    assert.equal(await page.locator('#createShippingButton').isDisabled(), true);
    assert.doesNotMatch(await page.locator('#salesWorkspace').textContent(), /SO-GOOD/);

    const horizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(horizontalOverflow <= 1, `mobile horizontal overflow: ${horizontalOverflow}px`);
    await page.screenshot({ path: 'artifacts/ui-verification/sales-shipping-mobile.png', fullPage: true });
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
  }
});

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
