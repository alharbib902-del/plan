import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { captureCronError } from '@/lib/monitoring/operational';
import {
  matchLeg,
  shouldMarkOutboxProcessed,
  type MatchOutcome,
} from '@/lib/empty-legs/matching';

/**
 * Phase 7 PR 2e — outbox drain cron (Codex round-1 P1 #1
 * fix on PR #33).
 *
 * Schedule: every 30 minutes (vercel.json). Same cadence
 * as the dutch-auction tick because the typical pending
 * sources are:
 *   - `notifications_disabled` skips during a flag-off
 *     window — the row replays after the flag flips
 *     back to `true`.
 *   - `price_dropped` events emitted by the
 *     dutch-auction-tick cron (the tick fires the event
 *     but does not run the matcher itself).
 *   - publish-time fire-and-forget POSTs that failed at
 *     the network boundary (rare; the matcher's per-leg
 *     dedupe via the unique index makes replay safe).
 *
 * Body:
 *   1. Auth via shared CRON_SECRET helper.
 *   2. Claim pending outbox rows ordered by `emitted_at`.
 *      Use a bounded LIMIT to keep one cron tick under
 *      Vercel's serverless duration cap.
 *   3. Group claimed rows by `event_type` so each leg
 *      runs through `matchLeg(legId, eventType)` exactly
 *      once per type (a leg with multiple pending rows of
 *      the same type still runs once — the per-leg dedupe
 *      via the unique `(lead_inquiry_id, leg_id)` index
 *      handles dupes downstream).
 *   4. For every outcome, decide via
 *      `shouldMarkOutboxProcessed(outcome)`:
 *        - true  → UPDATE rows WHERE id IN (claimed
 *                  outbox row ids for this leg/type) AND
 *                  processed_at IS NULL. Codex round-2
 *                  P1 #1 fix: marking by claimed row ids
 *                  (not by `leg_id + event_type`) leaves
 *                  any new row that landed for the same
 *                  leg/type during the matcher run for
 *                  the next cron tick to pick up.
 *        - false → leave the rows pending (replays on the
 *                  next cron tick after flag flip).
 *
 * Idempotent: if the synchronous match-trigger fire and
 * this drain race on the same leg, whichever wins marks
 * the outbox rows processed (`AND processed_at IS NULL`
 * filter); the loser sees zero rows updated and the
 * matcher's per-leg dedupe via the unique index ensures
 * no double-notification.
 *
 * No retry-on-failure inside the route; rows that remain
 * pending will be picked up on the next cron tick. Errors
 * are logged but do not 5xx the route — Vercel Cron
 * retries the route on 5xx, which would compound load
 * on the matcher.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const DRAIN_BATCH_LIMIT = 200;

interface PendingRow {
  id: string;
  leg_id: string;
  event_type: 'published' | 'price_dropped';
}

/**
 * Codex round-2 P1 #1 fix. The mark MUST be scoped to the
 * exact outbox row ids the cron read in step 2 of GET()
 * — never by `leg_id + event_type` predicates, which
 * would also flip the `processed_at` of any new row that
 * landed for the same leg/type during the matcher run.
 */
async function markOutboxRowsProcessed(
  client: ReturnType<typeof createAdminClient>,
  outboxRowIds: string[]
): Promise<void> {
  if (outboxRowIds.length === 0) return;
  const { error } = await client
    .from('empty_leg_events_outbox')
    .update({ processed_at: new Date().toISOString() })
    .in('id', outboxRowIds)
    .is('processed_at', null);
  if (error) {
    console.error('[cron.match-drain] outbox mark error', error);
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  const client = createAdminClient();
  const { data: pendingRows, error: claimError } = await client
    .from('empty_leg_events_outbox')
    .select('id, leg_id, event_type')
    .is('processed_at', null)
    .order('emitted_at', { ascending: true })
    .limit(DRAIN_BATCH_LIMIT);

  if (claimError) {
    console.error('[cron.match-drain] claim error', claimError);
    await captureCronError('empty-legs.match-drain', claimError);
    return NextResponse.json(
      { ok: false, error: 'claim_failed' },
      { status: 200 }
    );
  }

  const rows = (pendingRows ?? []) as PendingRow[];
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: true, claimed: 0, processed: 0, outcomes: [] },
      { status: 200 }
    );
  }

  // Group rows by (leg_id, event_type). A leg with
  // multiple pending rows of the same event_type only
  // runs through matchLeg once — replay safety via the
  // unique notifications index handles intra-cycle dupes.
  // We track the exact row ids per (leg_id, event_type)
  // pair so the eventual mark scopes to ONLY the rows
  // this cron tick claimed (Codex round-2 P1 #1).
  const byKey: Map<string, { eventType: 'published' | 'price_dropped'; legId: string; rowIds: string[] }> =
    new Map();
  for (const r of rows) {
    const key = `${r.event_type}:${r.leg_id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.rowIds.push(r.id);
    } else {
      byKey.set(key, {
        eventType: r.event_type,
        legId: r.leg_id,
        rowIds: [r.id],
      });
    }
  }

  const outcomes: MatchOutcome[] = [];
  const rowIdsToMark: string[] = [];

  for (const entry of byKey.values()) {
    const outcome = await matchLeg(entry.legId, entry.eventType);
    outcomes.push(outcome);
    if (shouldMarkOutboxProcessed(outcome)) {
      rowIdsToMark.push(...entry.rowIds);
    }
  }

  await markOutboxRowsProcessed(client, rowIdsToMark);

  return NextResponse.json(
    {
      ok: true,
      claimed: rows.length,
      processed: rowIdsToMark.length,
      outcomes,
    },
    { status: 200 }
  );
}
