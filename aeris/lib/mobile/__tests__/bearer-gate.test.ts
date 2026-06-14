import assert from 'node:assert';

import { resolveBearerSession } from '@/lib/mobile/bearer-gate';
import type {
  ValidateClientSessionResult,
  ClientSessionContext,
} from '@/lib/clients/auth';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

function session(passwordMustChange: boolean): ClientSessionContext {
  return {
    client_id: 'c-1',
    full_name: 'محمد',
    contact_phone: '+966500000000',
    expires_at: '2026-07-01T00:00:00Z',
    password_must_change: passwordMustChange,
  };
}
const valid = (pmc = false): ValidateClientSessionResult => ({
  ok: true,
  session: session(pmc),
});
const invalid = (
  reason: Exclude<ValidateClientSessionResult, { ok: true }>['reason']
): ValidateClientSessionResult => ({ ok: false, reason });

function code(input: Parameters<typeof resolveBearerSession>[0]): string {
  const d = resolveBearerSession(input);
  return d.ok ? '<ok>' : d.code;
}

// --- flag + token gates ---
test('portal disabled → flag_disabled (before anything else)', () => {
  assert.equal(
    code({ portalEnabled: false, hasToken: true, validation: valid() }),
    'flag_disabled'
  );
});
test('no token → missing_token', () => {
  assert.equal(code({ portalEnabled: true, hasToken: false }), 'missing_token');
});
test('portal+token but no validation (defensive) → invalid_session', () => {
  assert.equal(
    code({ portalEnabled: true, hasToken: true, validation: undefined }),
    'invalid_session'
  );
});

// --- validation reason normalisation ---
test('expired → session_expired', () => {
  assert.equal(
    code({ portalEnabled: true, hasToken: true, validation: invalid('expired') }),
    'session_expired'
  );
});
test('no_cookie (cookie-path-only) → invalid_session', () => {
  assert.equal(
    code({ portalEnabled: true, hasToken: true, validation: invalid('no_cookie') }),
    'invalid_session'
  );
});
test('invalid_session passes through', () => {
  assert.equal(
    code({ portalEnabled: true, hasToken: true, validation: invalid('invalid_session') }),
    'invalid_session'
  );
});
test('account_not_active passes through', () => {
  assert.equal(
    code({ portalEnabled: true, hasToken: true, validation: invalid('account_not_active') }),
    'account_not_active'
  );
});
test('rpc_error passes through', () => {
  assert.equal(
    code({ portalEnabled: true, hasToken: true, validation: invalid('rpc_error') }),
    'rpc_error'
  );
});

// --- password_must_change lockout ---
test('password_must_change=true (no override) → password_change_required', () => {
  assert.equal(
    code({ portalEnabled: true, hasToken: true, validation: valid(true) }),
    'password_change_required'
  );
});
test('password_must_change=true WITH allowPasswordChange → ok', () => {
  const d = resolveBearerSession({
    portalEnabled: true,
    hasToken: true,
    validation: valid(true),
    allowPasswordChange: true,
  });
  assert.equal(d.ok, true);
});

// --- happy path ---
test('valid session, no lock → ok + session passthrough', () => {
  const d = resolveBearerSession({
    portalEnabled: true,
    hasToken: true,
    validation: valid(false),
  });
  assert.equal(d.ok, true);
  if (d.ok) assert.equal(d.session.client_id, 'c-1');
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
