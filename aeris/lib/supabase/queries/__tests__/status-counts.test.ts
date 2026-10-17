/**
 * countRowsByStatus aggregation test (perf refactor 2026-10).
 *
 * Layer-1 (no DB), runs as `npm run test:supabase-status-counts`.
 *
 * The admin status chips (trips / leads / empty legs / operators) now
 * issue one head-only count per status + one unfiltered total instead
 * of downloading every row. This pins the aggregation contract with a
 * fake counter.
 */

import { strict as assert } from 'node:assert';

import {
  countRowsByStatus,
  type HeadCountResult,
} from '@/lib/supabase/queries/status-counts';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
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

const TRIP_STATUSES = [
  'pending',
  'distributed',
  'offered',
  'booked',
  'cancelled',
] as const;
type TripStatus = (typeof TRIP_STATUSES)[number];

// Fixture table: 2500 rows (past PostgREST's 1000 max-rows) incl. 3
// rows with a NULL status that only `total` may count.
function fixtureStatuses(): (TripStatus | null)[] {
  const rows: (TripStatus | null)[] = [];
  for (let i = 0; i < 2497; i++) rows.push(TRIP_STATUSES[i % 5]);
  rows.push(null, null, null);
  return rows;
}

function fakeCounter(
  rows: (TripStatus | null)[],
  calls: (TripStatus | null)[]
) {
  return async (status: TripStatus | null): Promise<HeadCountResult> => {
    calls.push(status);
    const count =
      status === null ? rows.length : rows.filter((s) => s === status).length;
    return { count, error: null };
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('\n[supabase-status-counts] running …\n');

  await test('per-status counts + separate total, past the 1000-row cap', async () => {
    const rows = fixtureStatuses();
    const calls: (TripStatus | null)[] = [];
    const { counts, error } = await countRowsByStatus(
      TRIP_STATUSES,
      fakeCounter(rows, calls)
    );
    assert.equal(error, null);
    assert.deepEqual(counts, {
      total: 2500,
      pending: 500,
      distributed: 500,
      offered: 499,
      booked: 499,
      cancelled: 499,
    });
  });

  await test('one total query + exactly one query per status', async () => {
    const calls: (TripStatus | null)[] = [];
    await countRowsByStatus(TRIP_STATUSES, fakeCounter([], calls));
    assert.deepEqual(calls, [null, ...TRIP_STATUSES]);
  });

  await test('empty table → all zeros', async () => {
    const { counts } = await countRowsByStatus(
      TRIP_STATUSES,
      fakeCounter([], [])
    );
    assert.deepEqual(counts, {
      total: 0,
      pending: 0,
      distributed: 0,
      offered: 0,
      booked: 0,
      cancelled: 0,
    });
  });

  await test('null count from PostgREST → 0', async () => {
    const { counts } = await countRowsByStatus(TRIP_STATUSES, async () => ({
      count: null,
      error: null,
    }));
    assert.equal(counts?.total, 0);
    assert.equal(counts?.booked, 0);
  });

  await test('any failed query → error surfaced, no partial counts', async () => {
    const result = await countRowsByStatus(TRIP_STATUSES, async (status) =>
      status === 'offered'
        ? { count: null, error: { message: 'timeout' } }
        : { count: 7, error: null }
    );
    assert.equal(result.counts, null);
    assert.deepEqual(result.error, { message: 'timeout' });
  });

  // eslint-disable-next-line no-console
  console.log(`\n[supabase-status-counts] ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void main();
