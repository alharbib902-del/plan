/**
 * Phase 7 PR 2e — frequency-cap pure-logic parity test.
 *
 * Layer-1 (no DB), runs as
 * `npm run test:empty-legs-frequency-cap`.
 *
 * The actual `frequency-cap.ts` reads from the
 * `empty_leg_notifications` table via the admin Supabase
 * client; this test exercises a local re-implementation of
 * the same business logic against a fixture set so we can
 * regression-guard the contract without DB dependency.
 *
 * Mocked reader returns `{ lead_inquiry_id, leg_id,
 * sent_at }` rows from `empty_leg_notifications` (Codex
 * iteration-6 P2 #2 fix — prior wording said "mock
 * `notifications` reader" which contradicted the
 * iteration-2 P1 #2 retargeting away from the legacy
 * `notifications` table).
 */

import { strict as assert } from 'node:assert';

import { FREQUENCY_CAP_PER_24H } from '@/lib/empty-legs/frequency-cap';

interface NotificationFixtureRow {
  lead_inquiry_id: string;
  leg_id: string;
  sent_at: string;
}

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
console.log('\n[empty-legs-frequency-cap] running …\n');

// ============================================================
// Local re-implementation of the cap logic — must stay in
// lockstep with `lib/empty-legs/frequency-cap.ts`. If the
// contract there changes, this re-impl + the assertions
// below need updating in the same commit.
// ============================================================

function countInLast24h(
  rows: NotificationFixtureRow[],
  leadInquiryId: string,
  now: Date = new Date()
): number {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return rows.filter(
    (r) =>
      r.lead_inquiry_id === leadInquiryId &&
      new Date(r.sent_at).getTime() > cutoff
  ).length;
}

function isOverCap(
  rows: NotificationFixtureRow[],
  leadInquiryId: string,
  capPer24h: number = FREQUENCY_CAP_PER_24H,
  now: Date = new Date()
): boolean {
  return countInLast24h(rows, leadInquiryId, now) >= capPer24h;
}

function hasNotifiedOnLeg(
  rows: NotificationFixtureRow[],
  leadInquiryId: string,
  legId: string
): boolean {
  return rows.some(
    (r) => r.lead_inquiry_id === leadInquiryId && r.leg_id === legId
  );
}

function shouldSkip(
  rows: NotificationFixtureRow[],
  leadInquiryId: string,
  legId: string,
  capPer24h: number = FREQUENCY_CAP_PER_24H,
  now: Date = new Date()
): boolean {
  return (
    isOverCap(rows, leadInquiryId, capPer24h, now) ||
    hasNotifiedOnLeg(rows, leadInquiryId, legId)
  );
}

const NOW = new Date('2026-06-15T12:00:00Z');
const HOURS_AGO = (h: number) =>
  new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

// ============================================================
// Tests
// ============================================================

test('cap default is 1 per 24h', () => {
  assert.equal(FREQUENCY_CAP_PER_24H, 1);
});

test('zero rows → not over cap, no skip', () => {
  assert.equal(isOverCap([], 'lead-A', 1, NOW), false);
  assert.equal(shouldSkip([], 'lead-A', 'leg-1', 1, NOW), false);
});

test('one row 12h ago → at cap (>=1), skip', () => {
  const rows: NotificationFixtureRow[] = [
    {
      lead_inquiry_id: 'lead-A',
      leg_id: 'leg-other',
      sent_at: HOURS_AGO(12),
    },
  ];
  assert.equal(isOverCap(rows, 'lead-A', 1, NOW), true);
  assert.equal(shouldSkip(rows, 'lead-A', 'leg-1', 1, NOW), true);
});

test('one row 25h ago → outside 24h window, not over cap', () => {
  const rows: NotificationFixtureRow[] = [
    {
      lead_inquiry_id: 'lead-A',
      leg_id: 'leg-other',
      sent_at: HOURS_AGO(25),
    },
  ];
  assert.equal(isOverCap(rows, 'lead-A', 1, NOW), false);
});

test('cap=2: one row in 24h not yet over, two rows are', () => {
  const rows: NotificationFixtureRow[] = [
    {
      lead_inquiry_id: 'lead-A',
      leg_id: 'leg-1',
      sent_at: HOURS_AGO(2),
    },
  ];
  assert.equal(isOverCap(rows, 'lead-A', 2, NOW), false);
  rows.push({
    lead_inquiry_id: 'lead-A',
    leg_id: 'leg-2',
    sent_at: HOURS_AGO(1),
  });
  assert.equal(isOverCap(rows, 'lead-A', 2, NOW), true);
});

test('per-leg dedupe: row exists for this lead+leg → skip even within cap', () => {
  // Cap is 5 per 24h (well above), no other rows for this
  // lead in 24h, but a row exists for this exact leg → must
  // still skip (per-leg dedupe is non-negotiable).
  const rows: NotificationFixtureRow[] = [
    {
      lead_inquiry_id: 'lead-A',
      leg_id: 'leg-1',
      sent_at: HOURS_AGO(36), // outside 24h
    },
  ];
  assert.equal(isOverCap(rows, 'lead-A', 5, NOW), false);
  assert.equal(hasNotifiedOnLeg(rows, 'lead-A', 'leg-1'), true);
  assert.equal(shouldSkip(rows, 'lead-A', 'leg-1', 5, NOW), true);
});

test('different lead within 24h → does not affect this lead', () => {
  const rows: NotificationFixtureRow[] = [
    {
      lead_inquiry_id: 'lead-OTHER',
      leg_id: 'leg-1',
      sent_at: HOURS_AGO(2),
    },
  ];
  assert.equal(isOverCap(rows, 'lead-A', 1, NOW), false);
  assert.equal(shouldSkip(rows, 'lead-A', 'leg-1', 1, NOW), false);
});

test('row exactly at the 24h boundary → strictly NOT counted (cutoff is exclusive: > cutoff)', () => {
  const rows: NotificationFixtureRow[] = [
    {
      lead_inquiry_id: 'lead-A',
      leg_id: 'leg-other',
      sent_at: HOURS_AGO(24),
    },
  ];
  // The reader uses `> cutoff` (strict), so a row at
  // exactly 24h is excluded.
  assert.equal(isOverCap(rows, 'lead-A', 1, NOW), false);
});

test('mixed scenario: dedupe wins even when cap is fine', () => {
  const rows: NotificationFixtureRow[] = [
    {
      lead_inquiry_id: 'lead-A',
      leg_id: 'leg-OTHER',
      sent_at: HOURS_AGO(36),
    },
    {
      lead_inquiry_id: 'lead-A',
      leg_id: 'leg-target',
      sent_at: HOURS_AGO(48),
    },
  ];
  assert.equal(isOverCap(rows, 'lead-A', 1, NOW), false);
  assert.equal(shouldSkip(rows, 'lead-A', 'leg-target', 1, NOW), true);
});

// eslint-disable-next-line no-console
console.log(
  `\n[empty-legs-frequency-cap] ${passed} passed, ${failed} failed\n`
);

if (failed > 0) {
  process.exit(1);
}
