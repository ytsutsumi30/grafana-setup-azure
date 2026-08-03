const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unexpectedApiResponse } = require('./console-check');
const TEST_BASE = 'http://localhost:8080';

function response(url, status) {
  return { url: () => url, status: () => status };
}

test('same-origin API errors fail console verification', () => {
  assert.equal(
    unexpectedApiResponse(response('http://localhost:8080/api/inventory/balances?lot=A', 500), TEST_BASE),
    'api-response: 500 /api/inventory/balances?lot=A'
  );
  assert.equal(
    unexpectedApiResponse(response('http://localhost:8080/api/products', 401), TEST_BASE),
    'api-response: 401 /api/products'
  );
});

test('successful, static, and cross-origin responses are ignored', () => {
  assert.equal(unexpectedApiResponse(response('http://localhost:8080/api/products', 200), TEST_BASE), null);
  assert.equal(unexpectedApiResponse(response('http://localhost:8080/css/components.css', 404), TEST_BASE), null);
  assert.equal(unexpectedApiResponse(response('https://login.microsoftonline.com/common', 401), TEST_BASE), null);
});
