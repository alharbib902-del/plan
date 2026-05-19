/**
 * Phase 13 PR 3 — local re-implementation parity test for
 * `expire_old_loyalty_credits()` (§4.6 RPC).
 *
 * Layer-1 (no DB). Runs as
 * `npm run test:privilege-cashback-expiry-fifo`.
 *
 * Why a re-implementation:
 *   The §4.6 PL/pgSQL function loops per-client, sums the
 *   `earn` entries past their `cashback_expiry_at`, caps the
 *   expired amount at the client's current denormalized
 *   balance, and posts one `expire` event per client. The
 *   contract is FIFO oldest-first (D18 — 24-month expiry).
 *
 * Coverage:
 *   - Single expired earn → full amount expired
 *   - Multiple expired earns → summed + single expire event
 *   - Expired earn + later un-expired earn → only the expired
 *     portion reduces balance
 *   - Expired earn previously redeemed → balance cap kicks in
 *   - Already-processed expiries (later `expire` event) → no-op
 *   - Empty ledger / zero balance → no-op
 */

import { strict as assert } from 'node:assert';

interface LedgerRow {
  event_type:
    | 'earn'
    | 'redeem'
    | 'adjust'
    | 'expire'
    | 'diamond_shield_granted'
    | 'diamond_shield_skipped_already_diamond'
    | 'diamond_shield_skipped_paying_paid_plan'
    | 'diamond_shield_revoked_on_downgrade'
    | 'diamond_shield_grant_failed';
  amount_sar: number;
  cashback_expiry_at: string | null;
  created_at: string;
}

interface ExpiryDecision {
  expired_amount_sar: number;
  reason: 'no_eligible_earns' | 'zero_balance' | 'already_processed' | 'expired';
}

/**
 * Mirror of the §4.6 RPC body. Returns the amount that would
 * be posted as a single `expire` event for this client at
 * `now`. Caller applies it to the denormalized balance and
 * appends the resulting ledger row.
 */
function decideExpiry(args: {
  ledger: LedgerRow[];
  denormalized_balance: number;
  now: Date;
}): ExpiryDecision {
  const { ledger, denormalized_balance, now } = args;

  if (denormalized_balance <= 0) {
    return { expired_amount_sar: 0, reason: 'zero_balance' };
  }

  // Latest expire event (if any) — gates the WHERE NOT EXISTS
  // sub-query so each expiry batch only counts earns whose
  // expiry_at is AFTER the last expire created_at.
  const latestExpireAt = ledger
    .filter((r) => r.event_type === 'expire')
    .map((r) => new Date(r.created_at).getTime())
    .reduce((max, t) => (t > max ? t : max), 0);

  // Earns whose expiry_at < now AND (no later expire was
  // already posted that supersedes them). Mirrors the SQL's
  // `NOT EXISTS (... AND expired.created_at > cashback_expiry_at)`
  // — strictly greater means equality is treated as still
  // eligible (which is fine because cron + ledger insert run
  // within the same statement so T_x > T_e effectively).
  const eligibleEarns = ledger.filter((r) => {
    if (r.event_type !== 'earn') return false;
    if (!r.cashback_expiry_at) return false;
    const expiryMs = new Date(r.cashback_expiry_at).getTime();
    if (expiryMs >= now.getTime()) return false;
    // Already superseded by a later expire event.
    if (expiryMs < latestExpireAt) return false;
    return true;
  });

  if (eligibleEarns.length === 0) {
    if (latestExpireAt > 0) {
      return { expired_amount_sar: 0, reason: 'already_processed' };
    }
    return { expired_amount_sar: 0, reason: 'no_eligible_earns' };
  }

  // FIFO sum + cap at current denormalized balance (mirrors
  // the SQL's LEAST(SUM(amount_sar), current_balance) guard).
  const summedSar = eligibleEarns.reduce(
    (sum, r) => sum + r.amount_sar,
    0
  );
  const capped = Math.min(summedSar, denormalized_balance);
  if (capped <= 0) {
    return { expired_amount_sar: 0, reason: 'zero_balance' };
  }
  return { expired_amount_sar: capped, reason: 'expired' };
}

// ============================================================
// Test harness
// ============================================================

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
console.log('\n[privilege-cashback-expiry-fifo] running …\n');

const NOW = new Date('2028-06-15T12:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (days: number) =>
  new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

test('empty ledger + zero balance → zero_balance no-op', () => {
  const decision = decideExpiry({
    ledger: [],
    denormalized_balance: 0,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 0);
  assert.equal(decision.reason, 'zero_balance');
});

test('one earn past expiry → full amount expires', () => {
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 500,
      cashback_expiry_at: daysAgo(10),
      created_at: daysAgo(730 + 10),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 500,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 500);
  assert.equal(decision.reason, 'expired');
});

test('FIFO: 2 expired earns → summed into single expire event', () => {
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 200,
      cashback_expiry_at: daysAgo(30),
      created_at: daysAgo(730 + 30),
    },
    {
      event_type: 'earn',
      amount_sar: 300,
      cashback_expiry_at: daysAgo(15),
      created_at: daysAgo(730 + 15),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 500,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 500);
});

test('Mixed expired + un-expired → only expired portion expires', () => {
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 200,
      cashback_expiry_at: daysAgo(5),
      created_at: daysAgo(730 + 5),
    },
    {
      event_type: 'earn',
      amount_sar: 400,
      cashback_expiry_at: daysFromNow(30),
      created_at: daysAgo(700),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 600,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 200);
});

test('Balance cap: expired earns > current balance → cap at balance', () => {
  // 600 SAR of expired earns but balance is only 250 (the
  // client redeemed 350 SAR already → can\'t expire more than
  // what\'s in the wallet).
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 600,
      cashback_expiry_at: daysAgo(10),
      created_at: daysAgo(730 + 10),
    },
    {
      event_type: 'redeem',
      amount_sar: -350,
      cashback_expiry_at: null,
      created_at: daysAgo(180),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 250,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 250);
});

test('Already processed: later expire event supersedes earlier earns', () => {
  // Client had a 500-SAR earn expire 30 days ago + the cron
  // already posted the matching expire event 29 days ago.
  // Running the cron AGAIN today should be a no-op.
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 500,
      cashback_expiry_at: daysAgo(30),
      created_at: daysAgo(730 + 30),
    },
    {
      event_type: 'expire',
      amount_sar: -500,
      cashback_expiry_at: null,
      created_at: daysAgo(29),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 0,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 0);
  assert.equal(decision.reason, 'zero_balance');
});

test('No-expiry earn (legacy row) is ignored', () => {
  // A row written before the cashback_expiry_at column existed
  // could appear with cashback_expiry_at=NULL. The §4.6 RPC
  // skips it (NULL filters fail the < NOW() predicate).
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 500,
      cashback_expiry_at: null,
      created_at: daysAgo(800),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 500,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 0);
  assert.equal(decision.reason, 'no_eligible_earns');
});

test('Future expiry (no expired earns yet) → no-op', () => {
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 1000,
      cashback_expiry_at: daysFromNow(60),
      created_at: daysAgo(670),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 1000,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 0);
  assert.equal(decision.reason, 'no_eligible_earns');
});

test('New earn AFTER prior expire still triggers next expiry cycle', () => {
  // Client had an old expiry cycle complete (expire event 60
  // days ago). Today a different earn whose expiry_at is past
  // NOW but AFTER the last expire's created_at should expire.
  const ledger: LedgerRow[] = [
    {
      event_type: 'expire',
      amount_sar: -200,
      cashback_expiry_at: null,
      created_at: daysAgo(60),
    },
    {
      event_type: 'earn',
      amount_sar: 100,
      cashback_expiry_at: daysAgo(10),
      created_at: daysAgo(730 + 10),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 100,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 100);
  assert.equal(decision.reason, 'expired');
});

// ============================================================
// Wrap up
// ============================================================

// eslint-disable-next-line no-console
console.log(
  `\n[privilege-cashback-expiry-fifo] ${passed} passed, ${failed} failed\n`
);
if (failed > 0) process.exit(1);
