const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';
const PAGES = ['purchase-receiving', 'sales-shipping', 'shipping-instructions'];
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 1000 }
];
const THEMES = ['light', 'dark'];

test('receiving, sales, and shipping screens remain usable across viewport and theme combinations', { timeout: 90000 }, async () => {
  const browser = await chromium.launch();

  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        await context.addInitScript((value) => localStorage.setItem('prj3-theme', value), theme);

        for (const pageName of PAGES) {
          const page = await context.newPage();
          const errors = [];
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
          });
          page.on('pageerror', (error) => errors.push(error.message));
          await mockEmptyApi(page);

          await page.goto(`${BASE}/${pageName}.html`, { waitUntil: 'networkidle' });
          await page.locator('.app-header').waitFor();
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
          const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow <= 1, `${pageName} ${viewport.name}/${theme} overflow: ${overflow}px`);
          const undersizedButtons = await page.locator('button:visible').evaluateAll((buttons) => buttons
            .map((button) => ({
              label: button.getAttribute('aria-label') || button.textContent.trim(),
              height: Math.round(button.getBoundingClientRect().height)
            }))
            .filter((button) => button.height < 48));
          assert.deepEqual(undersizedButtons, [], `${pageName} ${viewport.name}/${theme} touch targets`);
          assert.deepEqual(errors, [], `${pageName} ${viewport.name}/${theme} console errors`);
          await page.close();
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});

async function mockEmptyApi(page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/m365/config') return json(route, { enabled: false, required: false });
    if (url.pathname === '/api/auth/whoami') return json(route, { authenticated: false });
    if (['/api/products', '/api/suppliers', '/api/purchase-orders', '/api/receiving-orders',
      '/api/sales-orders', '/api/shipping-locations', '/api/delivery-locations',
      '/api/shipping-instructions'].includes(url.pathname)) return json(route, []);
    return json(route, { error: `Unhandled mock API: ${url.pathname}` }, 404);
  });
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
