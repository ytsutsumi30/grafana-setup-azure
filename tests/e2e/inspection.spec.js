/**
 * E2E: 主要フローのブラウザテスト(Playwright)
 * 注意: 実行にはブラウザとシステムライブラリが必要。
 *   npm i -D @playwright/test && npx playwright install --with-deps chromium
 *   BASE=http://localhost:8080 npx playwright test tests/e2e
 * WSL サンドボックスではシステムライブラリ(libnspr4 等)が無く実行不可のため、
 * このファイルはローカル/CI 実行用として用意している。
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE || 'http://localhost:8080';

test.describe('出荷検品システム 主要フロー', () => {
  test('トップ: 検品待ち一覧が読み込まれ、コンソールエラーがない', async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    await expect(page).toHaveTitle(/出荷検品システム/);
    // 検品待ちカウント要素が存在
    await expect(page.locator('#pending-count')).toBeVisible();
    expect(errors, 'console errors: ' + errors.join('\n')).toHaveLength(0);
  });

  test('メンテナンス: 共通ヘッダー(layout.js)が注入される', async ({ page }) => {
    await page.goto(`${BASE}/maintenance.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('.app-header')).toBeVisible();
    // マスタカードのリンクが存在
    await expect(page.locator('a[href="products.html"]')).toBeVisible();
  });

  test('テーマ切替がヘッダーのボタンで動作する', async ({ page }) => {
    await page.goto(`${BASE}/maintenance.html`, { waitUntil: 'networkidle' });
    await page.locator('[data-theme-toggle]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('外部CDNへのリクエストが発生しない(vendorローカル化の確認)', async ({ page }) => {
    const external = [];
    page.on('request', r => {
      const u = r.url();
      if (/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com/.test(u)) external.push(u);
    });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    expect(external, 'external CDN requests: ' + external.join('\n')).toHaveLength(0);
  });

  test('マスタ画面(製品)が一覧を表示する', async ({ page }) => {
    await page.goto(`${BASE}/products.html`, { waitUntil: 'networkidle' });
    // テーブルまたは行が描画される(データ有無に関わらずテーブル要素は存在)
    await expect(page.locator('table')).toBeVisible();
  });
});
