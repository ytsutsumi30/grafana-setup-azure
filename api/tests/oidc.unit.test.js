/**
 * OIDC 認可ロジックの単体テスト(node:test、外部依存なし・ネットワーク不要)
 * 実行: node --test api/tests/oidc.unit.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

function load(env) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  delete require.cache[require.resolve('../lib/oidc.js')];
  const logger = { info() {}, warn() {}, error() {} };
  const oidc = require('../lib/oidc.js')(logger);
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  return oidc;
}

test('isAllowed: Microsoft は常に許可(テナントは issuer で限定)', () => {
  const oidc = load({ MS_CLIENT_ID: 'x', MS_CLIENT_SECRET: 'y' });
  assert.equal(oidc.isAllowed({ provider: 'microsoft', email: 'a@corp.com' }), true);
});

test('isAllowed: Google はドメイン未設定なら任意許可', () => {
  const oidc = load({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_ALLOWED_DOMAINS: '' });
  assert.equal(oidc.isAllowed({ provider: 'google', email: 'anyone@gmail.com' }), true);
});

test('isAllowed: Google はドメイン設定時に非許可を弾く', () => {
  const oidc = load({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_ALLOWED_DOMAINS: 'corp.com' });
  assert.equal(oidc.isAllowed({ provider: 'google', email: 'a@corp.com' }), true);
  assert.equal(oidc.isAllowed({ provider: 'google', email: 'b@gmail.com' }), false);
});

// wallEnabled は AUTH_WALL を呼び出し時に読むため、env を維持したまま評価する
function evalWall(env) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  delete require.cache[require.resolve('../lib/oidc.js')];
  const oidc = require('../lib/oidc.js')({ info() {}, warn() {}, error() {} });
  const result = oidc.wallEnabled();
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  return result;
}

test('wallEnabled: AUTH_WALL=on + SESSION_SECRET + プロバイダ で有効', () => {
  assert.equal(evalWall({ AUTH_WALL: 'on', SESSION_SECRET: 's', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }), true);
});

test('wallEnabled: SESSION_SECRET 無しなら安全側で無効', () => {
  assert.equal(evalWall({ AUTH_WALL: 'on', SESSION_SECRET: '', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' }), false);
});

test('wallEnabled: プロバイダ未設定なら無効', () => {
  assert.equal(evalWall({ AUTH_WALL: 'on', SESSION_SECRET: 's' }), false);
});
