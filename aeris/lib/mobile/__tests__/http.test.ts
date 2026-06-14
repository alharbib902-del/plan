/**
 * Phase 0 (mobile API) — unit tests for the shared HTTP layer.
 *
 * Layer-1 (no DB). Runs as `npm run test:mobile-http`.
 *
 * Covers the wire contract the Flutter client depends on:
 *   - error code → HTTP status map (401 vs 403 vs 429 vs 5xx)
 *   - JSON envelope shapes ({ ok:true } / { ok:false, error })
 *   - bounded body reader (malformed / oversized / empty)
 */

import { strict as assert } from 'node:assert';

import {
  statusForError,
  readJsonBody,
  mobileOk,
  mobileError,
  MAX_JSON_BODY_BYTES,
  corsHeadersFor,
  mobilePreflight,
} from '@/lib/mobile/http';

function withCorsEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env.MOBILE_CORS_ALLOWED_ORIGINS;
  try {
    if (value === undefined) delete process.env.MOBILE_CORS_ALLOWED_ORIGINS;
    else process.env.MOBILE_CORS_ALLOWED_ORIGINS = value;
    fn();
  } finally {
    if (prev === undefined) delete process.env.MOBILE_CORS_ALLOWED_ORIGINS;
    else process.env.MOBILE_CORS_ALLOWED_ORIGINS = prev;
  }
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
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

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/mobile/test', {
    method: 'POST',
    body,
    headers,
  });
}

async function main(): Promise<void> {
await test('statusForError maps session errors to 401', () => {
  for (const c of [
    'missing_token',
    'invalid_session',
    'session_expired',
    'expired',
    'invalid_credentials',
    'invalid_token_hash',
  ]) {
    assert.equal(statusForError(c), 401, `${c} should be 401`);
  }
});

await test('statusForError maps flag/state/lockout to 403', () => {
  for (const c of [
    'flag_disabled',
    'account_not_active',
    'password_change_required',
    'client_not_active',
    'client_not_found',
  ]) {
    assert.equal(statusForError(c), 403, `${c} should be 403`);
  }
});

await test('statusForError maps owned-resource miss to 404', () => {
  assert.equal(statusForError('request_not_found'), 404);
});

await test('statusForError maps throttle to 429 and validation to 400', () => {
  assert.equal(statusForError('rate_limited'), 429);
  assert.equal(statusForError('validation_failed'), 400);
  assert.equal(statusForError('body_too_large'), 413);
});

await test('statusForError maps dependency faults to 5xx', () => {
  assert.equal(statusForError('rpc_failed'), 502);
  assert.equal(statusForError('rpc_error'), 502);
  assert.equal(statusForError('storage_error'), 503);
  assert.equal(statusForError('secret_missing'), 503);
});

await test('statusForError defaults unknown codes to 400', () => {
  assert.equal(statusForError('some_unmapped_code'), 400);
});

await test('mobileOk wraps payload with ok:true', async () => {
  const res = mobileOk({ client_id: 'abc' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; client_id: string };
  assert.equal(body.ok, true);
  assert.equal(body.client_id, 'abc');
});

await test('mobileError sets ok:false + mapped status', async () => {
  const res = mobileError('rate_limited');
  assert.equal(res.status, 429);
  const body = (await res.json()) as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.error, 'rate_limited');
});

await test('mobileError carries extra fields (field_errors)', async () => {
  const res = mobileError('validation_failed', { field_errors: { email: 'bad' } });
  assert.equal(res.status, 400);
  const body = (await res.json()) as {
    error: string;
    field_errors: Record<string, string>;
  };
  assert.equal(body.field_errors.email, 'bad');
});

await test('readJsonBody parses valid JSON', async () => {
  const r = await readJsonBody<{ a: number }>(jsonRequest('{"a":1}'));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.a, 1);
});

await test('readJsonBody treats empty body as empty object', async () => {
  const r = await readJsonBody<Record<string, unknown>>(jsonRequest(''));
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, {});
});

await test('readJsonBody rejects malformed JSON', async () => {
  const r = await readJsonBody(jsonRequest('{not json'));
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.error, 'malformed_body');
});

await test('readJsonBody rejects oversized declared content-length', async () => {
  const r = await readJsonBody(jsonRequest('{}', { 'content-length': '100' }), 10);
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.error, 'body_too_large');
});

await test('readJsonBody rejects oversized actual bytes', async () => {
  const big = JSON.stringify({ s: 'x'.repeat(100) });
  const r = await readJsonBody(jsonRequest(big), 10);
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.error, 'body_too_large');
});

await test('MAX_JSON_BODY_BYTES is 64 KiB', () => {
  assert.equal(MAX_JSON_BODY_BYTES, 64 * 1024);
});

await test('statusForError maps conflict codes to 409', () => {
  for (const c of [
    'leg_already_reserved',
    'offer_not_pending',
    'offer_expired',
    'trip_not_open',
    'accept_failed',
    'decline_not_allowed',
    'cancel_not_allowed',
    'booking_has_active_payment',
  ]) {
    assert.equal(statusForError(c), 409, `${c} should be 409`);
  }
});

await test('statusForError maps server-side write/dependency faults to 5xx', () => {
  assert.equal(statusForError('update_failed'), 502);
  assert.equal(statusForError('rpc_failed'), 502);
  assert.equal(statusForError('server_error'), 502);
});

await test('mobileError attaches custom headers (Retry-After on 429)', async () => {
  const res = mobileError(
    'rate_limited',
    { retry_after: 42 },
    { headers: { 'Retry-After': '42' } }
  );
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '42');
  const body = (await res.json()) as { retry_after: number };
  assert.equal(body.retry_after, 42);
});

await test('corsHeadersFor: no Origin header → no CORS (native client)', () => {
  assert.deepEqual(corsHeadersFor(new Request('http://localhost/x')), {});
});

await test('corsHeadersFor: off-allowlist Origin → no ACAO (fail-closed)', () => {
  withCorsEnv('https://app.aeris.sa', () => {
    const h = corsHeadersFor(
      new Request('http://localhost/x', {
        headers: { origin: 'https://evil.example' },
      })
    );
    assert.deepEqual(h, {});
  });
});

await test('corsHeadersFor: allowlisted Origin → echoes restricted ACAO', () => {
  withCorsEnv('https://app.aeris.sa, https://aeris.sa', () => {
    const h = corsHeadersFor(
      new Request('http://localhost/x', {
        headers: { origin: 'https://aeris.sa' },
      })
    );
    assert.equal(h['Access-Control-Allow-Origin'], 'https://aeris.sa');
    assert.equal(h['Vary'], 'Origin');
    assert.ok(h['Access-Control-Allow-Methods'].includes('POST'));
  });
});

await test('corsHeadersFor: never returns wildcard', () => {
  withCorsEnv('https://aeris.sa', () => {
    const h = corsHeadersFor(
      new Request('http://localhost/x', {
        headers: { origin: 'https://aeris.sa' },
      })
    );
    assert.notEqual(h['Access-Control-Allow-Origin'], '*');
  });
});

await test('mobilePreflight returns 204 with allowlisted CORS', () => {
  withCorsEnv('https://aeris.sa', () => {
    const res = mobilePreflight(
      new Request('http://localhost/x', {
        headers: { origin: 'https://aeris.sa' },
      })
    );
    assert.equal(res.status, 204);
    assert.equal(
      res.headers.get('access-control-allow-origin'),
      'https://aeris.sa'
    );
  });
});

  // eslint-disable-next-line no-console
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
