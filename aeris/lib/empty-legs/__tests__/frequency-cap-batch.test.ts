/**
 * Batched frequency-cap parity test (perf refactor 2026-10).
 *
 * Layer-1 (no DB), runs as `npm run test:empty-legs-frequency-cap-batch`.
 *
 * The matcher used to run two count queries per candidate
 * (24h cap + per-leg dedupe). It now calls
 * `collectRecipientsToSkip` once per candidate set. This suite feeds
 * the REAL batched implementation a fake page reader over fixture
 * `empty_leg_notifications` rows and asserts its skip set equals the
 * former per-candidate rule for every id — including chunking of the
 * id list and pagination past the PostgREST row cap.
 */

import { strict as assert } from 'node:assert';

import {
  FREQUENCY_CAP_PER_24H,
  collectRecipientsToSkip,
  selectRecipientsToSkip,
  type RecipientKey,
  type RecipientPageReader,
} from '@/lib/empty-legs/frequency-cap';

interface NotificationFixtureRow {
  id: string;
  lead_inquiry_id: string | null;
  client_id: string | null;
  leg_id: string;
  sent_at: string;
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
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

const NOW = new Date('2026-10-17T12:00:00Z');
const HOURS_AGO = (h: number) =>
  new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

// The former per-candidate gate, verbatim semantics:
//   overCap      = count(key = id AND sent_at > now-24h) >= cap
//   alreadyOnLeg = count(key = id AND leg_id = legId) > 0
function referenceShouldSkip(
  rows: NotificationFixtureRow[],
  key: RecipientKey,
  id: string,
  legId: string,
  cap: number
): boolean {
  const cutoff = NOW.getTime() - 24 * 60 * 60 * 1000;
  const recent = rows.filter(
    (r) => r[key] === id && new Date(r.sent_at).getTime() > cutoff
  ).length;
  const onLeg = rows.some((r) => r[key] === id && r.leg_id === legId);
  return recent >= cap || onLeg;
}

// Mirrors the PostgREST query: key IN ids + filter, ORDER BY id, range.
function fakeReader(
  rows: NotificationFixtureRow[],
  log: { chunkSizes: number[]; calls: number } = { chunkSizes: [], calls: 0 }
): RecipientPageReader {
  return async ({ key, ids, filter, from, to }) => {
    log.calls += 1;
    log.chunkSizes.push(ids.length);
    const wanted = new Set(ids);
    return rows
      .filter((r) => {
        const v = r[key];
        if (v === null || !wanted.has(v)) return false;
        return filter.kind === 'on_leg'
          ? r.leg_id === filter.legId
          : r.sent_at > filter.sentAfterIso;
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(from, to + 1)
      .map((r) => r[key]);
  };
}

function assertParity(
  skip: Set<string>,
  rows: NotificationFixtureRow[],
  key: RecipientKey,
  ids: string[],
  legId: string,
  cap: number
) {
  for (const id of ids) {
    assert.equal(
      skip.has(id),
      referenceShouldSkip(rows, key, id, legId, cap),
      `parity mismatch for ${key}=${id}`
    );
  }
  for (const id of skip) {
    assert.ok(ids.includes(id), `skip set leaked a non-candidate id ${id}`);
  }
}

// Small deterministic PRNG so failures are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('\n[empty-legs-frequency-cap-batch] running …\n');

  await test('default cap stays 1 per 24h', () => {
    assert.equal(FREQUENCY_CAP_PER_24H, 1);
  });

  await test('empty candidate set → empty skip set, zero reads', async () => {
    const log = { chunkSizes: [] as number[], calls: 0 };
    const skip = await collectRecipientsToSkip('lead_inquiry_id', [], 'leg-1', {
      read: fakeReader([], log),
      now: NOW,
    });
    assert.equal(skip.size, 0);
    assert.equal(log.calls, 0);
  });

  await test('fixture scenarios match the per-candidate rule', async () => {
    const rows: NotificationFixtureRow[] = [
      // lead-A: notified 12h ago on another leg → over cap
      { id: 'n01', lead_inquiry_id: 'lead-A', client_id: null, leg_id: 'leg-x', sent_at: HOURS_AGO(12) },
      // lead-B: only 25h ago → outside window, not skipped
      { id: 'n02', lead_inquiry_id: 'lead-B', client_id: null, leg_id: 'leg-x', sent_at: HOURS_AGO(25) },
      // lead-C: exactly 24h → excluded (strict > cutoff)
      { id: 'n03', lead_inquiry_id: 'lead-C', client_id: null, leg_id: 'leg-x', sent_at: HOURS_AGO(24) },
      // lead-D: notified on THIS leg 48h ago → per-leg dedupe skip
      { id: 'n04', lead_inquiry_id: 'lead-D', client_id: null, leg_id: 'leg-1', sent_at: HOURS_AGO(48) },
      // client row: must not count against any lead
      { id: 'n05', lead_inquiry_id: null, client_id: 'client-A', leg_id: 'leg-1', sent_at: HOURS_AGO(1) },
      // non-candidate lead: ignored
      { id: 'n06', lead_inquiry_id: 'lead-Z', client_id: null, leg_id: 'leg-1', sent_at: HOURS_AGO(1) },
    ];
    const ids = ['lead-A', 'lead-B', 'lead-C', 'lead-D', 'lead-E'];
    const skip = await collectRecipientsToSkip('lead_inquiry_id', ids, 'leg-1', {
      read: fakeReader(rows),
      now: NOW,
    });
    assert.deepEqual([...skip].sort(), ['lead-A', 'lead-D']);
    assertParity(skip, rows, 'lead_inquiry_id', ids, 'leg-1', 1);

    const clientSkip = await collectRecipientsToSkip(
      'client_id',
      ['client-A', 'client-B'],
      'leg-1',
      { read: fakeReader(rows), now: NOW }
    );
    assert.deepEqual([...clientSkip], ['client-A']);
  });

  await test('cap=2: one recent row is not enough, two are', () => {
    const one = selectRecipientsToSkip({
      ids: ['lead-A'],
      recentRecipientIds: ['lead-A'],
      legRecipientIds: [],
      capPer24h: 2,
    });
    assert.equal(one.has('lead-A'), false);
    const two = selectRecipientsToSkip({
      ids: ['lead-A'],
      recentRecipientIds: ['lead-A', null, 'lead-A'],
      legRecipientIds: [],
      capPer24h: 2,
    });
    assert.equal(two.has('lead-A'), true);
  });

  await test('chunks the id list and pages past the row cap', async () => {
    const rows: NotificationFixtureRow[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const lead = `lead-${String(i).padStart(2, '0')}`;
      ids.push(lead);
      // 3 rows per lead outside the window on other legs (forces
      // multi-page reads), plus a recent row for the even ones.
      for (let j = 0; j < 3; j++) {
        rows.push({
          id: `n-${lead}-${j}`,
          lead_inquiry_id: lead,
          client_id: null,
          leg_id: `leg-other-${j}`,
          sent_at: HOURS_AGO(30 + j),
        });
      }
      if (i % 2 === 0) {
        rows.push({
          id: `n-${lead}-recent`,
          lead_inquiry_id: lead,
          client_id: null,
          leg_id: 'leg-other-r',
          sent_at: HOURS_AGO(2),
        });
      }
      if (i === 7) {
        rows.push({
          id: `n-${lead}-onleg`,
          lead_inquiry_id: lead,
          client_id: null,
          leg_id: 'leg-1',
          sent_at: HOURS_AGO(40),
        });
      }
    }
    const log = { chunkSizes: [] as number[], calls: 0 };
    const skip = await collectRecipientsToSkip('lead_inquiry_id', ids, 'leg-1', {
      read: fakeReader(rows, log),
      now: NOW,
      chunkSize: 3,
      pageSize: 1,
    });
    assertParity(skip, rows, 'lead_inquiry_id', ids, 'leg-1', 1);
    assert.deepEqual(
      [...skip].sort(),
      ['lead-00', 'lead-02', 'lead-04', 'lead-06', 'lead-07', 'lead-08']
    );
    assert.ok(log.chunkSizes.every((n) => n <= 3), 'chunk size exceeded');
    assert.ok(log.calls > 8, 'expected paginated reads');
  });

  await test('duplicate candidate ids are read once and still skipped', async () => {
    const rows: NotificationFixtureRow[] = [
      { id: 'n1', lead_inquiry_id: 'lead-A', client_id: null, leg_id: 'leg-1', sent_at: HOURS_AGO(1) },
    ];
    const log = { chunkSizes: [] as number[], calls: 0 };
    const skip = await collectRecipientsToSkip(
      'lead_inquiry_id',
      ['lead-A', 'lead-A'],
      'leg-1',
      { read: fakeReader(rows, log), now: NOW }
    );
    assert.deepEqual([...skip], ['lead-A']);
    assert.deepEqual(log.chunkSizes, [1, 1]);
  });

  await test('randomized parity vs the per-candidate rule (500 trials)', async () => {
    const rand = mulberry32(20261017);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const keys: RecipientKey[] = ['lead_inquiry_id', 'client_id'];
    for (let trial = 0; trial < 500; trial++) {
      const key = pick(keys);
      const pool = Array.from({ length: 12 }, (_, i) => `r-${i}`);
      const legs = ['leg-1', 'leg-2', 'leg-3'];
      const rows: NotificationFixtureRow[] = [];
      const nRows = Math.floor(rand() * 40);
      for (let i = 0; i < nRows; i++) {
        const recipient = rand() < 0.1 ? null : pick(pool);
        const asLead = rand() < 0.5;
        rows.push({
          id: `n-${trial}-${i}`,
          lead_inquiry_id: asLead ? recipient : null,
          client_id: asLead ? null : recipient,
          leg_id: pick(legs),
          sent_at: HOURS_AGO(pick([0.5, 6, 23.9, 24, 24.1, 30, 72])),
        });
      }
      const ids = pool.filter(() => rand() < 0.6);
      const cap = pick([0, 1, 1, 1, 2, 3]);
      const skip = await collectRecipientsToSkip(key, ids, 'leg-1', {
        read: fakeReader(rows),
        now: NOW,
        capPer24h: cap,
        chunkSize: 1 + Math.floor(rand() * 5),
        pageSize: 1 + Math.floor(rand() * 4),
      });
      assertParity(skip, rows, key, ids, 'leg-1', cap);
    }
  });

  await test('a failed page read rejects (matcher keeps its retry path)', async () => {
    const boom: RecipientPageReader = async () => {
      throw new Error('db down');
    };
    await assert.rejects(
      collectRecipientsToSkip('client_id', ['client-A'], 'leg-1', {
        read: boom,
        now: NOW,
      }),
      /db down/
    );
  });

  // eslint-disable-next-line no-console
  console.log(
    `\n[empty-legs-frequency-cap-batch] ${passed} passed, ${failed} failed\n`
  );
  if (failed > 0) process.exit(1);
}

void main();
