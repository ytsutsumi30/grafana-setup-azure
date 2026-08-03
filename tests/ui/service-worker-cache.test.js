const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080';

test('service worker v34 activates only with a complete shell and serves the updated UI offline', { timeout: 90000 }, async () => {
  const proxy = await startLocalProxy(BASE);
  const testBase = `http://localhost:${proxy.address().port}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  try {
    await page.goto(`${testBase}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('service worker activation timeout')), 30000))
      ]);
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const cacheState = await page.evaluate(async () => {
      const keys = await caches.keys();
      const shell = await caches.open('prj3-shell-v34');
      const required = [
        '/purchase-receiving.html',
        '/css/components.css?v=2026080104',
        '/js/pages/purchase-receiving.js?v=2026080104'
      ];
      const matches = await Promise.all(required.map((path) => shell.match(path)));
      return { keys, cached: matches.map(Boolean) };
    });
    assert.ok(cacheState.keys.includes('prj3-shell-v34'), `cache keys: ${cacheState.keys.join(', ')}`);
    assert.deepEqual(cacheState.cached, [true, true, true]);

    await context.setOffline(true);
    await page.goto(`${testBase}/purchase-receiving.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('.app-header').waitFor();
    assert.match(await page.title(), /発注・入庫/);
    assert.equal(await page.locator('link[href*="2026080104"]').count() >= 3, true);
  } finally {
    await context.setOffline(false).catch(() => {});
    await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }
});

function startLocalProxy(target) {
  const upstream = new URL(target);
  const server = http.createServer((request, response) => {
    const proxyRequest = http.request({
      hostname: upstream.hostname,
      port: upstream.port || 80,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: upstream.host }
    }, (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    });
    proxyRequest.on('error', (error) => {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error.message);
    });
    request.pipe(proxyRequest);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
