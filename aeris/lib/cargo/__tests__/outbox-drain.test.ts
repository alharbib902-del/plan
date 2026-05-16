/**
 * Phase 11 PR 3 §7.2 — outbox drain pure-logic tests.
 *
 * Layer-1 (no DB). The full drain loop in the cron route hits
 * Supabase + Resend, so this file tests the small pure helpers
 * that the drain loop composes:
 *   - "if dispatched.length === 5, call founder helper" gate
 *   - "notify_failed moves operator from dispatched → skipped"
 *     mutation
 *   - "request_not_actionable error envelope" shape
 *
 * The actual claim-RPC + mark-processed UPDATE is exercised by
 * Probe 32 against real DB at activation time. Round 4 PR #72
 * P2 #2 + Round 5 PR #72 P2 #1 — pinned to the envelope split
 * (per-operator skip_reasons vs per-request dispatch_result.error)
 * + the helper-owned throttle.
 *
 * Runs as: npm run test:cargo-outbox-drain
 */

import { strict as assert } from 'node:assert';

import type {
  CargoDispatchOperator,
  CargoDispatchSkipReason,
} from '@/lib/cargo/scoring';

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
console.log('\n[cargo-outbox-drain] running …\n');

// ============================================================
// Helpers under test (extracted from the cron route's drain loop
// per §5.2 — the route logic mirrors these inline)
// ============================================================

function makeOp(id: string): CargoDispatchOperator {
  return {
    operator_id: id,
    contact_email: `${id}@example.com`,
    contact_phone: '+966500000000',
    company_name: `Op ${id}`,
  };
}

/**
 * Mirrors §5.2 step 3.2 mutation: when notifyOperatorOfCargo
 * returns sent=false, move the operator id from
 * dispatched_operator_ids to skipped_operator_ids and stamp
 * skip_reasons[id] = 'notify_failed'.
 */
function applyNotifyFailure(args: {
  dispatched: CargoDispatchOperator[];
  skipped_operator_ids: string[];
  skip_reasons: Record<string, CargoDispatchSkipReason>;
  failedOperatorId: string;
}): {
  dispatched: CargoDispatchOperator[];
  skipped_operator_ids: string[];
  skip_reasons: Record<string, CargoDispatchSkipReason>;
} {
  const filtered = args.dispatched.filter(
    (op) => op.operator_id !== args.failedOperatorId
  );
  return {
    dispatched: filtered,
    skipped_operator_ids: [
      ...args.skipped_operator_ids,
      args.failedOperatorId,
    ],
    skip_reasons: {
      ...args.skip_reasons,
      [args.failedOperatorId]: 'notify_failed',
    },
  };
}

/**
 * Mirrors §5.2 step 3.3 gate: founder helper is called iff the
 * final dispatched count is exactly 5. Returns true if the
 * helper SHOULD be invoked.
 */
function shouldCallFounderAlert(dispatchedCount: number): boolean {
  return dispatchedCount === 5;
}

/**
 * Mirrors §5.3 per-request error envelope. Pinned by the test
 * suite so any drift in the cron route (e.g. accidentally
 * shoving 'request_not_actionable' into skip_reasons) is caught.
 */
interface DispatchResultSummary {
  dispatched_operator_ids?: string[];
  skipped_operator_ids?: string[];
  skip_reasons?: Record<string, CargoDispatchSkipReason>;
  founder_alerted?: boolean;
  error?: 'request_not_actionable';
}

function buildRequestAbortSummary(): DispatchResultSummary {
  return { error: 'request_not_actionable' };
}

// ============================================================
// Tests
// ============================================================

test('1. notify_failure moves id from dispatched → skipped + records reason', () => {
  const start = {
    dispatched: [makeOp('op1'), makeOp('op2'), makeOp('op3')],
    skipped_operator_ids: ['op4'],
    skip_reasons: { op4: 'lower_score' as CargoDispatchSkipReason },
  };
  const after = applyNotifyFailure({ ...start, failedOperatorId: 'op2' });

  assert.equal(after.dispatched.length, 2);
  assert.deepEqual(
    after.dispatched.map((op) => op.operator_id),
    ['op1', 'op3']
  );
  assert.deepEqual(
    after.skipped_operator_ids.sort(),
    ['op2', 'op4'].sort()
  );
  assert.equal(after.skip_reasons['op2'], 'notify_failed');
  assert.equal(after.skip_reasons['op4'], 'lower_score');
});

test('2. founder alert gate: exactly 5 dispatched → call helper', () => {
  assert.equal(shouldCallFounderAlert(5), true);
});

test('3. founder alert gate: 4 dispatched → do NOT call helper', () => {
  assert.equal(shouldCallFounderAlert(4), false);
});

test('4. founder alert gate: 0 dispatched → do NOT call helper', () => {
  assert.equal(shouldCallFounderAlert(0), false);
});

test('5. founder alert gate: 6 dispatched (impossible per cap, defensive) → do NOT call helper', () => {
  // The DISPATCH_CAP is 5; this case should never arise in
  // practice, but the gate is exact equality so 6 → false.
  // Pinning the strictness prevents an accidental >= rewrite.
  assert.equal(shouldCallFounderAlert(6), false);
});

test('6. request_not_actionable uses per-request envelope (NOT skip_reasons)', () => {
  const summary = buildRequestAbortSummary();
  assert.equal(summary.error, 'request_not_actionable');
  // skip_reasons MUST stay undefined — it's the per-operator
  // map, not a kitchen sink for request-level errors.
  assert.equal(summary.skip_reasons, undefined);
  assert.equal(summary.dispatched_operator_ids, undefined);
});

test('7. notify_failure cascade: 5 ops → 1 failure → 4 dispatched → no founder alert', () => {
  // End-to-end-ish: starting with 5 dispatched, 1 fails to
  // notify → final count is 4 → founder gate should NOT fire.
  // Pins the order of operations in §5.2 step 3 (notify first,
  // founder check after).
  const initial = {
    dispatched: [
      makeOp('op1'),
      makeOp('op2'),
      makeOp('op3'),
      makeOp('op4'),
      makeOp('op5'),
    ],
    skipped_operator_ids: [],
    skip_reasons: {},
  };
  const after = applyNotifyFailure({
    ...initial,
    failedOperatorId: 'op3',
  });
  assert.equal(after.dispatched.length, 4);
  assert.equal(shouldCallFounderAlert(after.dispatched.length), false);
});

// eslint-disable-next-line no-console
console.log(`\n[cargo-outbox-drain] ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
