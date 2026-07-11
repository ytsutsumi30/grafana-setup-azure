#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8080}"
INSTRUCTION_ID="${INSTRUCTION_ID:-REVIEW-MULTI-001}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

node - "$BASE" "$INSTRUCTION_ID" "$AUTH_TOKEN" <<'NODE'
const assert = require('node:assert/strict');

const [base, instructionId, authToken] = process.argv.slice(2);
const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

async function get(path) {
  const res = await fetch(base + path, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { status: res.status, body };
}

function fail(message, detail) {
  console.error(`ERROR: ${message}`);
  if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

(async () => {
  console.log(`Field review API check: ${base}`);
  console.log(`Instruction: ${instructionId}`);

  const health = await get('/health');
  assert.equal(health.status, 200, '/health should return 200');

  const authConfig = await get('/api/auth/m365/config');
  assert.equal(authConfig.status, 200, '/api/auth/m365/config should return 200');
  console.log(`M365 auth: enabled=${Boolean(authConfig.body?.enabled)} required=${Boolean(authConfig.body?.required)}`);

  const list = await get(`/api/shipping-instructions?instruction_id=${encodeURIComponent(instructionId)}`);
  if (list.status === 401) {
    fail('shipping-instructions requires AUTH_TOKEN. Set AUTH_TOKEN to a valid M365 access token for Azure checks.');
  }
  assert.equal(list.status, 200, '/api/shipping-instructions should return 200');
  assert.ok(Array.isArray(list.body), '/api/shipping-instructions should return an array');

  const instruction = list.body.find((row) => row.instruction_id === instructionId);
  if (!instruction) fail(`Instruction ${instructionId} was not found`, list.body.slice(0, 5));
  console.log(`Found instruction id=${instruction.id} status=${instruction.status} quantity=${instruction.quantity}`);

  const pps = await get(`/api/shipping-instructions/${instruction.id}/pps-status`);
  assert.equal(pps.status, 200, '/pps-status should return 200');
  assert.equal(pps.body?.shipping?.instruction_id, instructionId, 'pps-status should return target shipping instruction');
  assert.ok(Array.isArray(pps.body.lines), 'pps-status.lines should be an array');
  assert.ok(Array.isArray(pps.body.allocations), 'pps-status.allocations should be an array');
  assert.ok(pps.body.lines.length >= 2, 'field review data should have at least 2 lines');
  assert.ok(pps.body.allocations.length >= 2, 'field review data should have at least 2 allocations');

  const allocationQty = pps.body.allocations.reduce((sum, row) => sum + Number(row.shipped_quantity || 0), 0);
  console.log(`PPS lines=${pps.body.lines.length} allocations=${pps.body.allocations.length} allocated=${allocationQty}`);

  const history = await get(`/api/shipping-instructions/${instruction.id}/history`);
  assert.equal(history.status, 200, '/history should return 200');
  assert.equal(history.body?.shipping?.instruction_id, instructionId, 'history should return target shipping instruction');
  assert.ok(Array.isArray(history.body.lines), 'history.lines should be an array');
  assert.ok(Array.isArray(history.body.allocations), 'history.allocations should be an array');
  assert.ok(Array.isArray(history.body.records), 'history.records should be an array');
  assert.ok(Array.isArray(history.body.audit_events), 'history.audit_events should be an array');
  console.log(`History lines=${history.body.lines.length} allocations=${history.body.allocations.length} records=${history.body.records.length} audit=${history.body.audit_events.length}`);

  const completion = await get(`/api/shipping-instructions/${instruction.id}/completion-status`);
  assert.equal(completion.status, 200, '/completion-status should return 200');
  assert.equal(typeof completion.body?.can_complete, 'boolean', 'completion-status.can_complete should be boolean');
  assert.ok(Array.isArray(completion.body.blockers), 'completion-status.blockers should be an array');
  console.log(`Completion can_complete=${completion.body.can_complete} blockers=${completion.body.blockers.length} warnings=${completion.body.warnings?.length || 0}`);

  console.log('Field review API check completed.');
})().catch((error) => {
  fail(error.message, error);
});
NODE
