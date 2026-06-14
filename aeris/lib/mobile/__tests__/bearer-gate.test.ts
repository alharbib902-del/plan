/**
 * Phase 0 (mobile API) — unit tests for the Bearer post-validation
 * gate (`resolveBearerSession`).
 *
 * Layer-1 (no DB, no session store). Runs as
 * `npm run test:mobile-bearer-gate`.
 *
 * Closes the Codex P3 follow-up on PR #149. Pins the security
 * contract every authed `/api/v1/mobile/*` route depends on:
 *   - a session with `password_must_change=true` is REJECTED with
 *     `password_change_required` (→ 403) on normal endpoints,
 *   - EXCEPT when the caller passes `allowPasswordChange: true`
 *     (the /me/session, /auth/logout, /auth/change-password hatches),
 *   - the internal `expired` reason is normalised to `session_expired`
 *     and every other reason passes through unchanged.
 */

import { strict as assert } from 'node:assert';

import type {
  ClientSessionContext,
  ValidateClientSessionResult,
} from '@/lib/clients/auth';
import { resolveBearerSession } from '@/lib/mobile/bearer-gate';
import { statusForError } from '@/lib/mobile/http';

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

function session(
  overrides: Partial<ClientSessionContext> = {}
): ClientSessionContext {
  return {
    client_id: 'client-1',
    full_name: 'Test Client',
    contact_phone: '+966500000000',
    expires_at: '2026-07-01T00:00:00Z',
    password_must_change: false,
    ...overrides,
  };
}

function valid(
  overrides: Partial<ClientSessionContext> = {}
): ValidateClientSessionResult {
  return { ok: true, session: session(overrides) };
}

// ============================================================
// password_must_change lockout (req 2)
// ============================================================

test('valid session, no lockout → ok with the session', () => {
  const d = resolveBearerSession(valid());
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.session.client_id, 'client-1');
});

test('password_must_change=true → REJECTED password_change_required', () => {
  const d = resolveBearerSession(valid({ password_must_change: true }));
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, 'password_change_required');
});

test('password_must_change=true + allowPasswordChange → ok (escape hatch)', () => {
  const d = resolveBearerSession(valid({ password_must_change: true }), {
    allowPasswordChange: true,
  });
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.session.password_must_change, true);
});

test('allowPasswordChange does NOT relax a non-lockout failure', () => {
  // The hatch only bypasses password_must_change — an invalid session
  // is still rejected even with allowPasswordChange:true.
  const d = resolveBearerSession(
    { ok: false, reason: 'invalid_session' },
    { allowPasswordChange: true }
  );
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, 'invalid_session');
});

// ============================================================
// reason normalization + passthrough
// ============================================================

test('expired → normalised to session_expired', () => {
  const d = resolveBearerSession({ ok: false, reason: 'expired' });
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, 'session_expired');
});

test('other failure reasons pass through unchanged', () => {
  for (const reason of [
    'invalid_session',
    'account_not_active',
    'invalid_token_hash',
    'rpc_error',
    'no_cookie',
  ] as const) {
    const d = resolveBearerSession({ ok: false, reason });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, reason);
  }
});

// ============================================================
// wire contract — the codes the gate emits map to the right status
// ============================================================

test('password_change_required maps to HTTP 403', () => {
  assert.equal(statusForError('password_change_required'), 403);
});

test('session_expired (+ raw reasons) map to HTTP 401', () => {
  assert.equal(statusForError('session_expired'), 401);
  assert.equal(statusForError('invalid_session'), 401);
  assert.equal(statusForError('invalid_token_hash'), 401);
});

test('rpc_error maps to a 5xx (dependency fault, not client error)', () => {
  assert.equal(statusForError('rpc_error'), 502);
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
