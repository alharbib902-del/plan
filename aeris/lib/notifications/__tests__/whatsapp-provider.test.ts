/**
 * Phase 8.1 — unit tests for whatsapp-provider.ts.
 *
 * Mirrors the lib/checkout/__tests__/whatsapp-message.test.ts
 * pattern: zero deps beyond Node's built-in assert + the SUT.
 * Run via:  npm run test:notifications-whatsapp-provider
 *
 * Cases covered:
 *   1.  normaliseSaudiPhoneE164 — already-E.164 passthrough
 *   2.  normaliseSaudiPhoneE164 — 00 international prefix
 *   3.  normaliseSaudiPhoneE164 — bare country code
 *   4.  normaliseSaudiPhoneE164 — Saudi 0-prefix local format
 *   5.  normaliseSaudiPhoneE164 — bare digits assumed Saudi
 *   6.  normaliseSaudiPhoneE164 — empty / non-string rejects
 *   7.  normaliseSaudiPhoneE164 — too short rejects
 *   8.  normaliseSaudiPhoneE164 — too long rejects
 *   9.  normaliseSaudiPhoneE164 — strips formatting chars
 *  10.  sendWhatsAppMessage — config_missing without API key
 *  11.  sendWhatsAppMessage — invalid_phone for malformed input
 *  12.  sendWhatsAppMessage — empty text returns send_failed
 *  13.  sendWhatsAppMessage — happy path returns provider_msg_id
 *  14.  sendWhatsAppMessage — 429 returns rate_limited
 *  15.  sendWhatsAppMessage — 401 returns send_failed
 *  16.  sendWhatsAppMessage — 5xx returns send_failed
 *  17.  sendWhatsAppMessage — non-JSON body tolerated
 *  18.  sendWhatsAppMessage — success:false body returns send_failed
 *  19.  Rate-limit guard — second call within 60s short-circuits
 *  20.  Rate-limit guard — different recipient also blocks
 *        (account-wide, Codex round 1 PR #46 P2 fix)
 *  21.  Rate-limit guard — guard records on failed network too
 */

import { strict as assert } from 'node:assert';

import {
  __test_resetWhatsAppRateLimitGuard,
  isRateLimited,
  normaliseSaudiPhoneE164,
  sendWhatsAppMessage,
} from '@/lib/notifications/whatsapp-provider';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${name}`);
      // eslint-disable-next-line no-console
      console.error(err instanceof Error ? err.message : err);
      failed++;
    });
}

// ============================================================
// fetch mock
// ============================================================

interface MockFetchCall {
  url: string;
  init: RequestInit | undefined;
}

const fetchCalls: MockFetchCall[] = [];
// Stash the LATEST configured response as a factory so each
// fetch call gets a fresh Response (otherwise the response
// body is consumed on the first .json() call and subsequent
// reads in the same test fail with "body already read").
let nextResponseFactory: () => Response = () =>
  jsonResponse(200, { success: true, data: {} });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

function setNextResponse(factory: () => Response): void {
  nextResponseFactory = factory;
}

function installFetchMock(): void {
  const mockFetch: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    fetchCalls.push({ url, init });
    return nextResponseFactory();
  };
  (globalThis as { fetch: typeof fetch }).fetch = mockFetch;
}

function resetFetchState(): void {
  fetchCalls.length = 0;
  setNextResponse(() => jsonResponse(200, { success: true, data: {} }));
}

// ============================================================
// Test execution
// ============================================================

async function main(): Promise<void> {
  installFetchMock();
  process.env.WASENDER_API_KEY = 'test-key';
  process.env.WASENDER_API_BASE_URL = 'https://test.wasender.local';

  // ----- normaliseSaudiPhoneE164 -----

  await test('normalise: already-E.164 passthrough', () => {
    assert.equal(normaliseSaudiPhoneE164('+966500000014'), '+966500000014');
  });

  await test('normalise: 00 international prefix', () => {
    assert.equal(normaliseSaudiPhoneE164('00966500000014'), '+966500000014');
  });

  await test('normalise: bare country code', () => {
    assert.equal(normaliseSaudiPhoneE164('966500000014'), '+966500000014');
  });

  await test('normalise: Saudi 0-prefix local', () => {
    assert.equal(normaliseSaudiPhoneE164('0500000014'), '+966500000014');
  });

  await test('normalise: bare digits assumed Saudi', () => {
    assert.equal(normaliseSaudiPhoneE164('500000014'), '+966500000014');
  });

  await test('normalise: empty string rejects', () => {
    assert.equal(normaliseSaudiPhoneE164(''), null);
    assert.equal(normaliseSaudiPhoneE164('   '), null);
  });

  await test('normalise: too short rejects', () => {
    assert.equal(normaliseSaudiPhoneE164('+12'), null);
  });

  await test('normalise: too long rejects', () => {
    assert.equal(normaliseSaudiPhoneE164('+1234567890123456'), null);
  });

  await test('normalise: strips formatting chars', () => {
    assert.equal(
      normaliseSaudiPhoneE164('+966 (50) 000-00-14'),
      '+966500000014'
    );
  });

  // ----- sendWhatsAppMessage failure paths -----

  await test('send: config_missing without API key', async () => {
    delete process.env.WASENDER_API_KEY;
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    const r = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'hi',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'config_missing');
    assert.equal(fetchCalls.length, 0);
    process.env.WASENDER_API_KEY = 'test-key';
  });

  await test('send: invalid_phone for malformed input', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    const r = await sendWhatsAppMessage({ to: 'not-a-phone', text: 'hi' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'invalid_phone');
    assert.equal(fetchCalls.length, 0);
  });

  await test('send: empty text returns send_failed', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    const r = await sendWhatsAppMessage({ to: '+966500000014', text: '   ' });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'send_failed');
    assert.equal(fetchCalls.length, 0);
  });

  // ----- sendWhatsAppMessage happy path -----

  await test('send: happy path returns provider_msg_id', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(200, {
        success: true,
        data: { msgId: 100023, jid: '+966500000014', status: 'in_progress' },
      })
    );
    const r = await sendWhatsAppMessage({
      to: '0500000014',
      text: 'hello',
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.provider_msg_id, 100023);
      assert.equal(r.jid, '+966500000014');
    }
    assert.equal(fetchCalls.length, 1);
    assert.equal(
      fetchCalls[0].url,
      'https://test.wasender.local/api/send-message'
    );
    const body = JSON.parse(String(fetchCalls[0].init?.body ?? '{}'));
    assert.equal(body.to, '+966500000014');
    assert.equal(body.text, 'hello');
    const headers = fetchCalls[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-key');
    assert.equal(headers['Content-Type'], 'application/json');
  });

  // ----- sendWhatsAppMessage HTTP error mapping -----

  await test('send: 429 returns rate_limited', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(429, { success: false, message: 'Trial bulk limit' })
    );
    const r = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'hi',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'rate_limited');
      assert.match(r.detail, /Trial bulk limit/);
    }
  });

  await test('send: 401 returns send_failed', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(401, { success: false, message: 'Invalid token' })
    );
    const r = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'hi',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'send_failed');
      assert.match(r.detail, /Invalid token/);
    }
  });

  await test('send: 500 returns send_failed', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(500, { success: false, message: 'oops' })
    );
    const r = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'hi',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'send_failed');
  });

  await test('send: non-JSON body tolerated', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() => textResponse(502, '<html>gateway</html>'));
    const r = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'hi',
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'send_failed');
  });

  await test('send: success:false body returns send_failed', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(200, { success: false, message: 'no active session' })
    );
    const r = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'hi',
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'send_failed');
      assert.match(r.detail, /no active session/);
    }
  });

  // ----- Rate-limit guard -----

  await test('guard: second call within window short-circuits', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(200, {
        success: true,
        data: { msgId: 1, jid: '+966500000014', status: 'in_progress' },
      })
    );
    const first = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'one',
    });
    assert.equal(first.ok, true);
    assert.equal(fetchCalls.length, 1);

    const second = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'two',
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, 'rate_limited');
    // Crucially: no second network call.
    assert.equal(fetchCalls.length, 1);
  });

  await test('guard: different recipient also blocks (account-wide)', async () => {
    // Codex round 1 PR #46 P2 fix: the wasender trial cap is
    // PER ACCOUNT, not per recipient. A welcome to operator A
    // followed by a reset to operator B in the same minute MUST
    // be locally throttled so the trial slot is preserved
    // instead of consumed by a server-side 429.
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(200, {
        success: true,
        data: { msgId: 1, jid: '', status: 'in_progress' },
      })
    );
    const a = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'a',
    });
    const b = await sendWhatsAppMessage({
      to: '+966500000015',
      text: 'b',
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, false);
    if (!b.ok) assert.equal(b.reason, 'rate_limited');
    // Crucially: only the first send made a network call. The
    // second short-circuited on the local guard.
    assert.equal(fetchCalls.length, 1);
    // Global guard state: any recipient lookup now reports
    // rate-limited until the window elapses.
    assert.equal(isRateLimited(), true);
  });

  await test('guard: records on failed network too', async () => {
    __test_resetWhatsAppRateLimitGuard();
    resetFetchState();
    setNextResponse(() =>
      jsonResponse(500, { success: false, message: 'oops' })
    );
    const first = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'one',
    });
    assert.equal(first.ok, false);
    assert.equal(fetchCalls.length, 1);

    // Even though the first call failed, the guard must still
    // count it — the wasender trial counts attempts not
    // successes.
    const second = await sendWhatsAppMessage({
      to: '+966500000014',
      text: 'two',
    });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.reason, 'rate_limited');
    assert.equal(fetchCalls.length, 1);
  });

  // ============================================================
  // Summary
  // ============================================================
  // eslint-disable-next-line no-console
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
