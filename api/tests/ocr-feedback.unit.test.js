const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const createOcrFeedbackRoutes = require('../routes/ocr-feedback');

async function startApp() {
  const queries = [];
  const app = express();
  app.use(express.json());
  app.use('/ocr-feedback', createOcrFeedbackRoutes({
    pool: {
      async query(sql, values) {
        queries.push({ sql, values });
        if (sql.includes('INSERT INTO')) return { rows: [{ id: 42 }] };
        return { rows: [] };
      }
    },
    logger: { info() {}, error() {} },
    requireAdmin: (_req, res) => res.status(403).json({ error: 'Forbidden' })
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, queries, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('OCR feedback validates input, stores parameterized values, and protects data reads', async () => {
  const fixture = await startApp();
  try {
    const invalid = await fetch(`${fixture.base}/ocr-feedback/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine: 'test', originalText: 'before', correctedText: 'after', confidence: 101 })
    });
    assert.equal(invalid.status, 400);

    const created = await fetch(`${fixture.base}/ocr-feedback/submit`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine: 'test', originalText: 'before', correctedText: 'after', confidence: 95 })
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.success, true);
    assert.equal(body.feedbackId, 42);
    assert.equal(body.accuracy, createOcrFeedbackRoutes.calculateAccuracy('before', 'after'));
    assert.match(fixture.queries[0].sql, /\$1/);
    assert.deepEqual(fixture.queries[0].values.slice(0, 3), ['test', 'before', 'after']);

    const protectedRead = await fetch(`${fixture.base}/ocr-feedback/training-data`);
    assert.equal(protectedRead.status, 403);
  } finally {
    await fixture.close();
  }
});

test('calculateAccuracy returns predictable character-level scores', () => {
  assert.equal(createOcrFeedbackRoutes.calculateAccuracy('', ''), 100);
  assert.equal(createOcrFeedbackRoutes.calculateAccuracy('abc', 'abc'), 100);
  assert.ok(Math.abs(createOcrFeedbackRoutes.calculateAccuracy('abc', 'axc') - (100 * 2 / 3)) < 1e-12);
});
