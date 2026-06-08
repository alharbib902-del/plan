/**
 * DB-01 — local re-implementation parity test for the FIXED
 * `expire_old_loyalty_credits()` (§4.6 RPC) once the FIFO walk
 * attributes consumption across ALL positive credits, not just
 * `earn` rows.
 *
 * Layer-1 (no DB). Runs as
 * `npm run test:privilege-cashback-expiry-fifo-adjust`.
 *
 * The earlier FIFO re-impl (cashback-expiry-fifo.test.ts) walked
 * `earn` rows only. Referral rewards post positive `adjust` rows
 * with NULL expiry that count toward the balance and never expire.
 * With those invisible to the walk, a `redeem` drawn from a
 * non-expiring adjust credit was mis-attributed to an OLDER expired
 * earn — making the earn look consumed, so it escaped clawback.
 *
 * This re-impl mirrors the FIXED SQL:
 *   - credit stream = `earn` rows PLUS positive `adjust` rows,
 *     ordered by created_at ASC (FIFO).
 *   - total_consumed = |redeem + expire + NEGATIVE adjust|.
 *   - only credits with cashback_expiry_at < NOW() can expire, so a
 *     positive adjust (NULL expiry) absorbs consumption but is never
 *     itself expired.
 *
 * Coverage (the new behaviour the migration adds):
 *   - DB-01 regression: older non-expiring adjust + newer expired
 *     earn + redeem that exactly eats the adjust → the expired earn
 *     IS clawed back (would be a 0 no-op under the earn-only walk).
 *   - Positive adjust credit alone, past where an expiry would land,
 *     never expires (NULL expiry).
 *   - Negative adjust (admin clawback) counts as consumption and
 *     consumes the expired earn → no double clawback.
 *   - Partial: redeem eats the whole adjust + part of the expired
 *     earn → only the unconsumed expired remainder expires.
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
 * Mirror of the FIXED §4.6 RPC body. Returns the amount that would
 * be posted as a single `expire` event for this client at `now`.
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

  // 1. total_consumed = |redeem + expire + NEGATIVE adjust| over the
  //    full ledger (every balance-reducing event).
  const totalConsumed = ledger
    .filter(
      (r) =>
        r.event_type === 'redeem' ||
        r.event_type === 'expire' ||
        (r.event_type === 'adjust' && r.amount_sar < 0)
    )
    .reduce((sum, r) => sum + Math.abs(r.amount_sar), 0);

  // 2. Positive credit stream = `earn` rows PLUS positive `adjust`
  //    rows, sorted by created_at ASC for the FIFO walk.
  const credits = ledger
    .filter(
      (r) =>
        r.event_type === 'earn' ||
        (r.event_type === 'adjust' && r.amount_sar > 0)
    )
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  // 3. Project cumulative_amount + remaining per credit (SQL WINDOW +
  //    CASE mirror). Only EXPIRED credits contribute to the expiry sum
  //    — positive adjust rows carry NULL expiry and fail the predicate,
  //    so they absorb consumption but never expire.
  let cumulative = 0;
  let expiredRemaining = 0;
  let hasEligibleExpiredEarn = false;

  for (const credit of credits) {
    cumulative += credit.amount_sar;
    let remaining: number;
    if (cumulative <= totalConsumed) {
      remaining = 0;
    } else if (cumulative - credit.amount_sar >= totalConsumed) {
      remaining = credit.amount_sar;
    } else {
      remaining = cumulative - totalConsumed;
    }

    if (
      credit.cashback_expiry_at &&
      new Date(credit.cashback_expiry_at).getTime() < now.getTime()
    ) {
      hasEligibleExpiredEarn = true;
      expiredRemaining += remaining;
    }
  }

  if (expiredRemaining <= 0) {
    if (hasEligibleExpiredEarn) {
      return { expired_amount_sar: 0, reason: 'already_consumed' };
    }
    return { expired_amount_sar: 0, reason: 'no_eligible_earns' };
  }

  // 4. Defensive cap at denormalized balance.
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
console.log('\n[privilege-cashback-expiry-fifo-adjust] running …\n');

const NOW = new Date('2028-06-15T12:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

// ============================================================
// DB-01 — the bug this migration fixes.
// ============================================================

test('DB-01: non-expiring adjust + expired earn + redeem that eats the adjust → expired earn IS clawed back', () => {
  // - adjust +300 (referral reward, NULL expiry) created earliest
  // - earn +200 (expired 10 days ago) created after the adjust
  // - redeem -300 (FIFO: consumes the whole 300 adjust → the earn is
  //   fully un-consumed)
  // FIFO credit stream by created_at: adjust(cum=300), earn(cum=500).
  // total_consumed = 300. earn: 500-200=300 >= 300 → remaining 200.
  // earn is expired → expire 200.
  //
  // Under the OLD earn-only walk: earns=[earn(cum=200)],
  // total_consumed=300, 200<=300 → remaining 0 → it WRONGLY escaped.
  const ledger: LedgerRow[] = [
    {
      event_type: 'adjust',
      amount_sar: 300,
      cashback_expiry_at: null,
      created_at: daysAgo(800),
    },
    {
      event_type: 'earn',
      amount_sar: 200,
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
  assert.equal(decision.reason, 'expired');
});

test('Positive adjust credit (NULL expiry) never expires on its own', () => {
  // A lone non-expiring referral reward is past where a 24-month
  // expiry would have landed, but it has no expiry → no clawback.
  const ledger: LedgerRow[] = [
    {
      event_type: 'adjust',
      amount_sar: 500,
      cashback_expiry_at: null,
      created_at: daysAgo(900),
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

test('Negative adjust (admin clawback) counts as consumption → expired earn already consumed, no double clawback', () => {
  // - earn +500 (expired 10 days ago)
  // - adjust -500 (admin manual clawback 5 days ago)
  // FIFO: total_consumed = 500 (the negative adjust). earn cum=500,
  // 500<=500 → remaining 0. Balance already 0 → no-op.
  const ledger: LedgerRow[] = [
    {
      event_type: 'earn',
      amount_sar: 500,
      cashback_expiry_at: daysAgo(10),
      created_at: daysAgo(730 + 10),
    },
    {
      event_type: 'adjust',
      amount_sar: -500,
      cashback_expiry_at: null,
      created_at: daysAgo(5),
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

test('Partial: redeem eats the whole adjust + part of the expired earn → only the unconsumed expired remainder expires', () => {
  // - adjust +200 (NULL expiry) earliest
  // - earn +500 (expired 10 days ago)
  // - redeem -350 (FIFO: 200 adjust + 150 of the earn → earn has 350
  //   remaining, all expired)
  // FIFO: total_consumed = 350. adjust cum=200 (200<=350 → 0, not
  // expired anyway). earn cum=700: 700-500=200 < 350, and 700>350 →
  // remaining = 700-350 = 350. earn expired → expire 350.
  const ledger: LedgerRow[] = [
    {
      event_type: 'adjust',
      amount_sar: 200,
      cashback_expiry_at: null,
      created_at: daysAgo(800),
    },
    {
      event_type: 'earn',
      amount_sar: 500,
      cashback_expiry_at: daysAgo(10),
      created_at: daysAgo(730 + 10),
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
    denormalized_balance: 350,
    now: NOW,
  });
  assert.equal(decision.expired_amount_sar, 350);
  assert.equal(decision.reason, 'expired');
});

// ============================================================
// Wrap up
// ============================================================

// eslint-disable-next-line no-console
console.log(
  `\n[privilege-cashback-expiry-fifo-adjust] ${passed} passed, ${failed} failed\n`
);
if (failed > 0) process.exit(1);
