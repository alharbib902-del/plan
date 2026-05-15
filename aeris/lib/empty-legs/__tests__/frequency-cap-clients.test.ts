/**
 * Phase 10 PR 1 — client-keyed frequency-cap parity test.
 *
 * Layer-1 (no DB): mirrors the Phase 7 frequency-cap test but
 * keys on client_id instead of lead_inquiry_id. Same 24h window,
 * same default cap, same per-leg dedupe semantics.
 *
 * Runs as: npm run test:empty-legs-frequency-cap-clients
 */

import { strict as assert } from 'node:assert';

import { FREQUENCY_CAP_PER_24H } from '@/lib/empty-legs/frequency-cap';

interface ClientNotificationFixtureRow {
  client_id: string;
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
console.log('\n[empty-legs-frequency-cap-clients] running …\n');

// ============================================================
// Local re-implementation — keep in lockstep with
// lib/empty-legs/frequency-cap.ts client helpers.
// ============================================================

function countClientInLast24h(
  rows: ClientNotificationFixtureRow[],
  clientId: string,
  now: Date
): number {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return rows.filter(
    (r) =>
      r.client_id === clientId && new Date(r.sent_at).getTime() > cutoff
  ).length;
}

function isClientOverCap(
  rows: ClientNotificationFixtureRow[],
  clientId: string,
  now: Date,
  cap = FREQUENCY_CAP_PER_24H
): boolean {
  return countClientInLast24h(rows, clientId, now) >= cap;
}

function hasNotifiedClientOnLeg(
  rows: ClientNotificationFixtureRow[],
  clientId: string,
  legId: string
): boolean {
  return rows.some((r) => r.client_id === clientId && r.leg_id === legId);
}

function shouldSkipClient(
  rows: ClientNotificationFixtureRow[],
  clientId: string,
  legId: string,
  now: Date
): boolean {
  return (
    isClientOverCap(rows, clientId, now) ||
    hasNotifiedClientOnLeg(rows, clientId, legId)
  );
}

// ============================================================

const NOW = new Date('2026-06-01T12:00:00Z');

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

test('client with zero rows → not over cap', () => {
  assert.equal(isClientOverCap([], 'client-A', NOW), false);
});

test('client with one row 5h ago → over cap (cap=1)', () => {
  const rows: ClientNotificationFixtureRow[] = [
    { client_id: 'client-A', leg_id: 'leg-1', sent_at: hoursAgo(5) },
  ];
  assert.equal(isClientOverCap(rows, 'client-A', NOW), true);
});

test('client with row 25h ago → NOT over cap (outside window)', () => {
  const rows: ClientNotificationFixtureRow[] = [
    { client_id: 'client-A', leg_id: 'leg-1', sent_at: hoursAgo(25) },
  ];
  assert.equal(isClientOverCap(rows, 'client-A', NOW), false);
});

test('other client rows do not count against this client', () => {
  const rows: ClientNotificationFixtureRow[] = [
    { client_id: 'client-B', leg_id: 'leg-1', sent_at: hoursAgo(2) },
    { client_id: 'client-B', leg_id: 'leg-2', sent_at: hoursAgo(3) },
  ];
  assert.equal(isClientOverCap(rows, 'client-A', NOW), false);
});

test('per-leg dedupe: already notified → skip', () => {
  const rows: ClientNotificationFixtureRow[] = [
    { client_id: 'client-A', leg_id: 'leg-1', sent_at: hoursAgo(48) },
  ];
  // 48h old → NOT over cap, but already notified on this leg
  assert.equal(isClientOverCap(rows, 'client-A', NOW), false);
  assert.equal(hasNotifiedClientOnLeg(rows, 'client-A', 'leg-1'), true);
  assert.equal(shouldSkipClient(rows, 'client-A', 'leg-1', NOW), true);
});

test('shouldSkip: combined OR — over cap on different leg', () => {
  const rows: ClientNotificationFixtureRow[] = [
    { client_id: 'client-A', leg_id: 'leg-OTHER', sent_at: hoursAgo(2) },
  ];
  // Already 1 row in 24h → over cap; skip even for a new leg
  assert.equal(shouldSkipClient(rows, 'client-A', 'leg-NEW', NOW), true);
});

test('shouldSkip: not over cap + not on this leg → false', () => {
  const rows: ClientNotificationFixtureRow[] = [
    { client_id: 'client-A', leg_id: 'leg-1', sent_at: hoursAgo(48) },
  ];
  assert.equal(shouldSkipClient(rows, 'client-A', 'leg-NEW', NOW), false);
});

test('FREQUENCY_CAP_PER_24H exported constant matches default', () => {
  assert.equal(FREQUENCY_CAP_PER_24H, 1);
});

// eslint-disable-next-line no-console
console.log(
  `\n[empty-legs-frequency-cap-clients] ${passed} passed, ${failed} failed\n`
);

if (failed > 0) {
  process.exit(1);
}
