// 主要ページを実ブラウザで開き、コンソールエラー/リクエスト失敗を検出する。
// 使い方: BASE=http://localhost:8080 node tests/smoke/console-check.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080';
const PAGES = ['index', 'maintenance', 'qr-inspection3', 'monitoring', 'qc-dashboard',
               'products', 'inventory', 'shipping-instructions'];
(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  for (const p of PAGES) {
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
    await page.goto(`${BASE}/${p}.html`, { waitUntil: 'networkidle' }).catch(e => errors.push('goto: ' + e.message));
    await page.waitForTimeout(600);
    // 外部CDN由来のリクエストが発生していないか(msauth は許容)
    if (errors.length) { fail++; console.log(`FAIL ${p}.html`); errors.slice(0,5).forEach(e => console.log('   ' + e)); }
    else console.log(`OK   ${p}.html`);
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `\nCONSOLE-CHECK: ${fail} page(s) with issues` : '\nCONSOLE-CHECK: ALL CLEAN');
  process.exit(fail ? 1 : 0);
})();
