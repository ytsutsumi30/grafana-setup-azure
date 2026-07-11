const { test } = require('node:test');
const assert = require('node:assert');

const authPath = require.resolve('../lib/auth.js');
const managedKeys = [
  'NODE_ENV', 'WRITE_AUTH_MODE', 'M365_AUTH_ENABLED', 'M365_AUTH_TENANT_ID',
  'M365_AUTH_CLIENT_ID', 'ADMIN_API_TOKEN'
];

function loadAuth(env) {
  const saved = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));
  for (const key of managedKeys) delete process.env[key];
  Object.assign(process.env, env);
  delete require.cache[authPath];
  const auth = require('../lib/auth.js')({ info() {}, warn() {}, error() {} });
  for (const key of managedKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  return auth;
}

test('production defaults write authentication to enforce and rejects missing credentials', () => {
  const auth = loadAuth({ NODE_ENV: 'production' });
  assert.equal(auth.writeAuthMode, 'enforce');
  assert.equal(auth.validateProductionConfiguration().length, 1);
});

test('explicit local off mode remains available for Docker development', () => {
  const auth = loadAuth({ NODE_ENV: 'production', WRITE_AUTH_MODE: 'off' });
  assert.equal(auth.writeAuthMode, 'off');
  assert.deepEqual(auth.validateProductionConfiguration(), []);
});

test('a sufficiently long administrator token satisfies enforce mode', () => {
  const auth = loadAuth({ NODE_ENV: 'production', WRITE_AUTH_MODE: 'enforce', ADMIN_API_TOKEN: 'a'.repeat(32) });
  assert.deepEqual(auth.validateProductionConfiguration(), []);
});
