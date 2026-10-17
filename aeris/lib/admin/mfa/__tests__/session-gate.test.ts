/**
 * Admin session gate (mandatory MFA enrolment) — pure-logic test.
 *
 * Layer-1 (no DB, no cookies). Runs as
 * `npm run test:admin-mfa-session-gate`.
 *
 * Covers the decision table behind requireAdminSession():
 *   - gate ORDER: mfa_pending → must_change_password → enrolment → role
 *   - the enrolment gate is skipped while a challenge / rotation is
 *     pending, and fails CLOSED when the enrolment state is unknown
 *   - loop-freedom: from every admin surface, following the gate's
 *     redirects always terminates on a surface that renders, and
 *     signOut is reachable from every state
 */

import { strict as assert } from 'node:assert';

import { ADMIN_WRITE_ROLES } from '@/lib/admin/rbac';
import {
  ADMIN_FORBIDDEN_PATH,
  ADMIN_MFA_CHALLENGE_PATH,
  ADMIN_MFA_ENROLL_PATH,
  ADMIN_PASSWORD_ROTATION_PATH,
  evaluateAdminSessionGate,
  mfaEnrollmentGateApplies,
  type AdminSessionGateOptions,
  type AdminSessionGateState,
  type AdminSessionGateVerdict,
} from '@/lib/admin/mfa/session-gate';

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
    console.log(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// eslint-disable-next-line no-console
console.log('\n[admin-mfa-session-gate] running …\n');

const FULL: AdminSessionGateState = {
  mfaPending: false,
  mustChangePassword: false,
  role: 'owner',
  mfaEnrollment: 'enrolled',
};

function redirectTo(verdict: AdminSessionGateVerdict): string | null {
  return verdict.kind === 'redirect' ? verdict.to : null;
}

// ============================================================
// Decision table
// ============================================================

test('enrolled, rotated, no pending challenge → allow', () => {
  assert.deepEqual(evaluateAdminSessionGate(FULL, {}), { kind: 'allow' });
});

test('not enrolled → forced to the enrolment page', () => {
  const v = evaluateAdminSessionGate(
    { ...FULL, mfaEnrollment: 'not_enrolled' },
    {}
  );
  assert.equal(redirectTo(v), ADMIN_MFA_ENROLL_PATH);
});

test('not enrolled + allowMfaUnenrolled (enrol surfaces) → allow', () => {
  const v = evaluateAdminSessionGate(
    { ...FULL, mfaEnrollment: null },
    { allowMfaUnenrolled: true }
  );
  assert.deepEqual(v, { kind: 'allow' });
});

test('unknown enrolment state fails CLOSED (never treated as enrolled)', () => {
  assert.deepEqual(
    evaluateAdminSessionGate({ ...FULL, mfaEnrollment: 'unknown' }, {}),
    { kind: 'mfa_state_unavailable' }
  );
  assert.deepEqual(
    evaluateAdminSessionGate({ ...FULL, mfaEnrollment: null }, {}),
    { kind: 'mfa_state_unavailable' }
  );
});

test('pending MFA challenge wins over everything else', () => {
  const v = evaluateAdminSessionGate(
    {
      ...FULL,
      mfaPending: true,
      mustChangePassword: true,
      mfaEnrollment: null,
    },
    { roles: ADMIN_WRITE_ROLES }
  );
  assert.equal(redirectTo(v), ADMIN_MFA_CHALLENGE_PATH);
});

test('must_change_password beats the enrolment gate', () => {
  const v = evaluateAdminSessionGate(
    { ...FULL, mustChangePassword: true, mfaEnrollment: null },
    {}
  );
  assert.equal(redirectTo(v), ADMIN_PASSWORD_ROTATION_PATH);
});

test('rotation page/action stays reachable for an un-enrolled admin', () => {
  const v = evaluateAdminSessionGate(
    { ...FULL, mustChangePassword: true, mfaEnrollment: null },
    { allowMustChangePassword: true }
  );
  assert.deepEqual(v, { kind: 'allow' });
});

test('challenge page/action never bounces into enrolment', () => {
  const v = evaluateAdminSessionGate(
    { ...FULL, mfaPending: true, mfaEnrollment: null },
    { allowMfaPending: true, allowMustChangePassword: true }
  );
  assert.deepEqual(v, { kind: 'allow' });
});

test('enrolment gate runs before the role gate', () => {
  const unenrolledSupport = evaluateAdminSessionGate(
    { ...FULL, role: 'support', mfaEnrollment: 'not_enrolled' },
    { roles: ADMIN_WRITE_ROLES }
  );
  assert.equal(redirectTo(unenrolledSupport), ADMIN_MFA_ENROLL_PATH);

  const enrolledSupport = evaluateAdminSessionGate(
    { ...FULL, role: 'support' },
    { roles: ADMIN_WRITE_ROLES }
  );
  assert.equal(redirectTo(enrolledSupport), ADMIN_FORBIDDEN_PATH);
});

test('mfaEnrollmentGateApplies only when nothing else is pending and no opt-out', () => {
  const base = { mfaPending: false, mustChangePassword: false };
  assert.equal(mfaEnrollmentGateApplies(base, {}), true);
  assert.equal(
    mfaEnrollmentGateApplies(base, { allowMfaUnenrolled: true }),
    false
  );
  assert.equal(
    mfaEnrollmentGateApplies({ ...base, mfaPending: true }, {}),
    false
  );
  assert.equal(
    mfaEnrollmentGateApplies({ ...base, mustChangePassword: true }, {}),
    false
  );
});

// ============================================================
// Loop-freedom across every admin surface
// ============================================================

// The opts each real caller passes (see lib/admin/auth.ts callers).
const SURFACES: Record<string, AdminSessionGateOptions> = {
  protected_layout: {},
  protected_write_action: { roles: ADMIN_WRITE_ROLES },
  [ADMIN_FORBIDDEN_PATH]: {},
  [ADMIN_MFA_CHALLENGE_PATH]: {
    allowMfaPending: true,
    allowMustChangePassword: true,
  },
  [ADMIN_PASSWORD_ROTATION_PATH]: { allowMustChangePassword: true },
  [ADMIN_MFA_ENROLL_PATH]: { allowMfaUnenrolled: true },
  sign_out: {
    allowMfaPending: true,
    allowMustChangePassword: true,
    allowMfaUnenrolled: true,
  },
};

type Enrollment = 'enrolled' | 'not_enrolled';

function gateFor(
  session: {
    mfaPending: boolean;
    mustChangePassword: boolean;
    role: AdminSessionGateState['role'];
    enrollment: Enrollment;
  },
  opts: AdminSessionGateOptions
): AdminSessionGateVerdict {
  // Mirrors requireAdminSession: the enrolment state is only read
  // when the gate applies.
  const base = {
    mfaPending: session.mfaPending,
    mustChangePassword: session.mustChangePassword,
    role: session.role,
  };
  return evaluateAdminSessionGate(
    {
      ...base,
      mfaEnrollment: mfaEnrollmentGateApplies(base, opts)
        ? session.enrollment
        : null,
    },
    opts
  );
}

test('every surface × every session state reaches a rendering page (no loop)', () => {
  for (const mfaPending of [false, true]) {
    for (const mustChangePassword of [false, true]) {
      for (const enrollment of ['enrolled', 'not_enrolled'] as const) {
        for (const role of ['owner', 'support'] as const) {
          const session = { mfaPending, mustChangePassword, role, enrollment };
          for (const [start, startOpts] of Object.entries(SURFACES)) {
            const seen = new Set<string>([start]);
            let verdict = gateFor(session, startOpts);
            while (verdict.kind === 'redirect') {
              const next = verdict.to;
              const label = `${JSON.stringify(session)} from ${start}`;
              assert.ok(!seen.has(next), `redirect loop at ${next} — ${label}`);
              seen.add(next);
              const nextOpts = SURFACES[next];
              assert.ok(nextOpts, `unmodelled redirect target ${next}`);
              verdict = gateFor(session, nextOpts);
            }
            assert.equal(
              verdict.kind,
              'allow',
              `ended in ${verdict.kind} for ${JSON.stringify(session)} from ${start}`
            );
          }
        }
      }
    }
  }
});

test('signOut is allowed from every session state', () => {
  for (const mfaPending of [false, true]) {
    for (const mustChangePassword of [false, true]) {
      for (const enrollment of ['enrolled', 'not_enrolled'] as const) {
        const v = gateFor(
          { mfaPending, mustChangePassword, role: 'support', enrollment },
          SURFACES.sign_out!
        );
        assert.deepEqual(v, { kind: 'allow' });
      }
    }
  }
});

test('an un-enrolled, rotated admin lands on the enrolment page from the dashboard', () => {
  const v = gateFor(
    {
      mfaPending: false,
      mustChangePassword: false,
      role: 'admin',
      enrollment: 'not_enrolled',
    },
    SURFACES.protected_layout!
  );
  assert.equal(redirectTo(v), ADMIN_MFA_ENROLL_PATH);
});

// eslint-disable-next-line no-console
console.log(
  `\n[admin-mfa-session-gate] ${passed} passed, ${failed} failed\n`
);
if (failed > 0) process.exit(1);
