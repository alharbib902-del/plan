// Push PR3a — unit tests for the delivery RPC envelope parsers.
// Layer-1 (no DB). Runs as `npm run test:push-delivery-parse`.

import { strict as assert } from 'node:assert';

import { parseClaimResult, parseMarkResult } from '@/lib/push/delivery-parse';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    failed++;
  }
}

test('claim: a transport error → rpc_failed', () => {
  assert.deepEqual(parseClaimResult(null, new Error('boom')), {
    ok: false,
    error: 'rpc_failed',
  });
});

test('claim: ok=false passes the wire code through', () => {
  assert.deepEqual(
    parseClaimResult({ ok: false, error: 'invalid_input' }, null),
    { ok: false, error: 'invalid_input' }
  );
});

test('claim: claimed=false (already delivered / not due)', () => {
  assert.deepEqual(parseClaimResult({ ok: true, claimed: false }, null), {
    ok: true,
    claimed: false,
  });
});

test('claim: claimed=true carries delivery_id + attempt', () => {
  assert.deepEqual(
    parseClaimResult(
      { ok: true, claimed: true, delivery_id: 'd-1', attempt: 3 },
      null
    ),
    { ok: true, claimed: true, deliveryId: 'd-1', attempt: 3 }
  );
});

test('claim: claimed=true WITHOUT delivery_id → rpc_failed (un-markable)', () => {
  assert.deepEqual(parseClaimResult({ ok: true, claimed: true }, null), {
    ok: false,
    error: 'rpc_failed',
  });
});

test('claim: claimed=true with id but missing attempt → attempt defaults 0', () => {
  assert.deepEqual(
    parseClaimResult({ ok: true, claimed: true, delivery_id: 'd-9' }, null),
    { ok: true, claimed: true, deliveryId: 'd-9', attempt: 0 }
  );
});

test('claim: null data → rpc_failed', () => {
  assert.deepEqual(parseClaimResult(null, null), {
    ok: false,
    error: 'rpc_failed',
  });
});

test('mark: ok → {ok:true}', () => {
  assert.deepEqual(parseMarkResult({ ok: true }, null), { ok: true });
});

test('mark: delivery_not_found passes through', () => {
  assert.deepEqual(
    parseMarkResult({ ok: false, error: 'delivery_not_found' }, null),
    { ok: false, error: 'delivery_not_found' }
  );
});

test('mark: transport error → rpc_failed', () => {
  assert.deepEqual(parseMarkResult(undefined, new Error('x')), {
    ok: false,
    error: 'rpc_failed',
  });
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
