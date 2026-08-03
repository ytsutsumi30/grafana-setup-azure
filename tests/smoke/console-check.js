// 主要ページを実ブラウザで開き、コンソールエラー/リクエスト失敗を検出する。
// 使い方: BASE=http://localhost:8080 PAGES=shipping-instructions node tests/smoke/console-check.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;
const DEFAULT_PAGES = ['index', 'maintenance', 'qr-inspection', 'qr-inspection3', 'monitoring', 'qc-dashboard',
                       'products', 'inventory', 'inventory-foundation', 'purchase-receiving',
                       'sales-shipping', 'shipping-instructions'];
const PAGES = (process.env.PAGES || '')
  .split(',')
  .map(page => page.trim().replace(/^\//, '').replace(/\.html$/, ''))
  .filter(Boolean);
const TARGETS = PAGES.length ? PAGES : DEFAULT_PAGES;

function unexpectedApiResponse(response, baseUrl = BASE) {
  const status = response.status();
  if (status < 400) return null;
  const url = new URL(response.url());
  const base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith('/api/')) return null;
  return `api-response: ${status} ${url.pathname}${url.search}`;
}

async function main() {
  if (SCREENSHOT_DIR) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  let fail = 0;
  for (const p of TARGETS) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('requestfailed', r => {
      const u = r.url();
      if (u.includes('/vendor/') || u.includes('/css/') || u.endsWith('.js'))
        errors.push('requestfailed: ' + u);
    });
    page.on('response', response => {
      const apiError = unexpectedApiResponse(response);
      if (apiError) errors.push(apiError);
    });
    await page.goto(`${BASE}/${p}.html`, { waitUntil: 'networkidle' }).catch(e => errors.push('goto: ' + e.message));
    await page.waitForTimeout(600);
    if (SCREENSHOT_DIR) await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${p}.png`), fullPage: true });
    // 外部CDN由来のリクエストが発生していないか(msauth は許容)
    if (errors.length) { fail++; console.log(`FAIL ${p}.html`); errors.slice(0,5).forEach(e => console.log('   ' + e)); }
    else console.log(`OK   ${p}.html`);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `\nCONSOLE-CHECK: ${fail} page(s) with issues` : '\nCONSOLE-CHECK: ALL CLEAN');
  process.exit(fail ? 1 : 0);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { unexpectedApiResponse };
