/**
 * Phase 13 PR 3 — local re-implementation parity test for
 * `expire_old_loyalty_credits()` (§4.6 RPC).
 *
 * Layer-1 (no DB). Runs as
 * `npm run test:privilege-cashback-expiry-fifo`.
 *
 * Round 1 PR #83 P1 fix — earlier version mirrored the broken
 * SQL (sum-all-expired then cap at balance). This re-impl now
 * walks earns FIFO and only counts UNCONSUMED portions of
 * expired earns. Adds the Codex regression scenario.
 *
 * Algorithm (mirrors the FIFO SQL in §4.6):
 *   1. total_consumed = absolute sum of redeem + expire amounts
 *   2. Walk earns ordered by created_at ASC, project a running
 *      cumulative_amount.
 *   3. For each earn, "remaining" =
 *        0                                if cumulative_amount <= total_consumed
 *        amount_sar                       if cumulative_amount - amount_sar >= total_consumed
 *        cumulative_amount - total_consumed   otherwise (partial)
 *   4. Sum remaining over EXPIRED earns → that's the expire
 *      amount for this run.
 *   5. Cap at denormalized balance (drift protection).
 *
 * Coverage:
 *   - Single expired earn → full amount expired
 *   - Multiple expired earns → summed FIFO
 *   - Expired + un-expired mix → only expired portion expires
 *   - Codex P1: old expired earn already consumed by redeem
 *     → 0 expiry (regression of the over-expire bug)
 *   - Balance cap (defensive, drift only)
 *   - Already-processed expiries (later `expire` event) → no-op
 *   - Realistic 2-cycle scenario: old earn expired + already-
 *     processed, NEW earn just expired → only the new one expires
 *   - Empty ledger / zero balance / future-only earns → no-op
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
  reason: 'no_eligible_earns' | 'zero_balance' | 'already_consumed' | 'expired';
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

  // 1. total_consumed = |redeem + expire| over the full ledger.
  const totalConsumed = ledger
    .filter((r) => r.event_type === 'redeem' || r.event_type === 'expire')
    .reduce((sum, r) => sum + Math.abs(r.amount_sar), 0);

  // 2. Earns sorted by created_at ASC for FIFO walk.
  const earns = ledger
    .filter((r) => r.event_type === 'earn')
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  // 3. Project cumulative_amount + remaining per earn (SQL
  //    WINDOW + CASE mirror).
  let cumulative = 0;
  let expiredRemaining = 0;
  let hasEligibleExpiredEarn = false;

  for (const earn of earns) {
    cumulative += earn.amount_sar;
    let remaining: number;
    if (cumulative <= totalConsumed) {
      remaining = 0;
    } else if (cumulative - earn.amount_sar >= totalConsumed) {
      remaining = earn.amount_sar;
    } else {
      remaining = cumulative - totalConsumed;
    }

    if (
      earn.cashback_expiry_at &&
      new Date(earn.cashback_expiry_at).getTime() < now.getTime()
    ) {
      hasEligibleExpiredEarn = true;
      expiredRemaining += remaining;
    }
  }

  if (expiredRemaining <= 0) {
    if (hasEligibleExpiredEarn) {
      // The earn(s) past expiry exist, but the FIFO walk shows
      // they've already been consumed by a prior redeem/expire.
      return { expired_amount_sar: 0, reason: 'already_consumed' };
    }
    return { expired_amount_sar: 0, reason: 'no_eligible_earns' };
  }

  // 5. Defensive cap at denormalized balance.
  const capped = Math.min(expiredRemaining, denormalized_balance);
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

// ============================================================
// Round 1 PR #83 P1 — Codex regression scenario.
// ============================================================

test('Codex P1: old expired earn already consumed by redeem → 0 expiry', () => {
  // - earn1 200 (expired 10 days ago)
  // - earn2 400 (not expired, expires in 1 year)
  // - redeem -350 (FIFO: consumed all 200 of earn1 + 150 of
  //   earn2 → earn2 has 250 remaining, earn1 has 0 remaining)
  // → No expire event should fire (earn1 is fully consumed).
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 200,
      cashback_expiry_at: daysAgo(10),
      created_at: daysAgo(730 + 10),
    },
    {
      event_type: 'earn',
      amount_sar: 400,
      cashback_expiry_at: daysFromNow(365),
      created_at: daysAgo(365),
    },
    {
      event_type: 'redeem',
      amount_sar: -350,
      cashback_expiry_at: null,
      created_at: daysAgo(30),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 250,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 0);
  assert.equal(decision.reason, 'already_consumed');
});

test('FIFO partial: redeem ate part of the expired earn → only unconsumed expires', () => {
  // - earn1 500 (expired 10 days ago)
  // - redeem -300 (FIFO: consumed 300 of earn1 → remaining 200)
  // → expire 200 (the unconsumed portion of the expired earn).
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 500,
      cashback_expiry_at: daysAgo(10),
      created_at: daysAgo(730 + 10),
    },
    {
      event_type: 'redeem',
      amount_sar: -300,
      cashback_expiry_at: null,
      created_at: daysAgo(30),
    },
  ];
  const decision = decideExpiry({
    ledger,
    denormalized_balance: 200,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 200);
});

test('Balance cap (drift): FIFO says 250, balance only 200 → cap', () => {
  // FIFO says 250 should expire (earn 600 - redeem 350 = 250
  // remaining of the expired earn). Balance is only 200 due
  // to admin drift → cap at 200.
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
    denormalized_balance: 200,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 200);
});

test('Already processed: prior expire fully consumed the earn → no-op', () => {
  // Client had a 500-SAR earn expire 30 days ago + the cron
  // already posted the matching expire event 29 days ago.
  // FIFO total_consumed = 500; earn cumulative = 500; remaining = 0.
  // → No double-expire.
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

test('Two-cycle: prior earn already expired + new earn just expired → expire only the new one', () => {
  // Realistic 2-cycle scenario (the original test fixture was
  // FIFO-inconsistent — a 200 expire could not be sourced from
  // a 100 earn). Now the prior earn matches the prior expire,
  // and the new earn is the only thing to expire today.
  //   - earn1 200 (expired 30 days ago) — consumed by expire1
  //   - expire1 -200 (29 days ago) — closed earn1 fully
  //   - earn2 100 (expired 1 day ago) — eligible now
  // FIFO: total_consumed = 200. earn1 cumulative=200, remaining=0.
  // earn2 cumulative=300, remaining=100 (300-200). earn2 expired
  // → expire 100.
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 200,
      cashback_expiry_at: daysAgo(30),
      created_at: daysAgo(730 + 30),
    },
    {
      event_type: 'expire',
      amount_sar: -200,
      cashback_expiry_at: null,
      created_at: daysAgo(29),
    },
    {
      event_type: 'earn',
      amount_sar: 100,
      cashback_expiry_at: daysAgo(1),
      created_at: daysAgo(730 + 1),
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
