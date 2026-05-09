import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import {
  matchLeg,
  shouldMarkOutboxProcessed,
  type MatchOutcome,
} from '@/lib/empty-legs/matching';

/**
 * Phase 7 PR 2e — internal match-trigger route.
 *
 * Two callers:
 *   - Synchronous fire-and-forget POST from
 *     `adminPublishEmptyLeg` (PR 2b) and
 *     `operatorPublishEmptyLeg` (PR 2c) after a successful
 *     `publish_empty_leg` RPC. Body: `{ leg_ids: [<id>],
 *     event: 'published' }`.
 *   - Cron drainage (the published outbox). Same body
 *     shape with the leg ids the cron claims.
 *
 * Body:
 *   1. Auth via shared CRON_SECRET helper.
 *   2. Parse `leg_ids` (UUID[]) + `event`.
 *   3. For EACH leg id, call `matchLeg(legId, event)` and
 *      collect outcomes. The matcher applies the per-leg
 *      ordered branches (suppress → disabled → candidates).
 *   4. For every outcome, decide via
 *      `shouldMarkOutboxProcessed(outcome)`:
 *        - true  → UPDATE outbox WHERE leg_id = X AND
 *                  processed_at IS NULL; SET processed_at
 *                  = NOW().
 *        - false → leave the row pending (replays on next
 *                  cron tick after flag flip).
 *   5. Returns the per-leg outcome list.
 *
 * Idempotent: if the synchronous fire and the cron drain
 * race on the same leg, whichever wins marks the outbox row
 * processed (`AND processed_at IS NULL` filter); the loser
 * sees zero rows updated and the matcher's per-leg dedupe
 * via the `(lead_inquiry_id, leg_id)` unique index ensures
 * no double-notification.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface RequestPayload {
  leg_ids: string[];
  event: 'published' | 'price_dropped';
}

function isValidPayload(value: unknown): value is RequestPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.leg_ids)) return false;
  if (v.leg_ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    return false;
  }
  if (v.event !== 'published' && v.event !== 'price_dropped') return false;
  return true;
}

/**
 * Codex round-2 P1 #1 fix. Mark MUST be scoped to the
 * exact outbox row ids this invocation read at claim
 * time — never by `leg_id + event_type` predicates,
 * which would also flip the `processed_at` of any new
 * row that landed for the same leg/type during the
 * matcher run.
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
    console.error('[match-trigger] outbox mark error', error);
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'malformed_body' },
      { status: 400 }
    );
  }
  if (!isValidPayload(parsed)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload' },
      { status: 400 }
    );
  }

  // Codex round-2 P1 #1 fix. Read the exact outbox row
  // ids that exist for the requested legs/event NOW,
  // before running the matcher. The eventual mark scopes
  // to ONLY these ids — a new row that lands for the
  // same leg/event during the matcher run is left for
  // the next match-drain cron tick to claim.
  const client = createAdminClient();
  const { data: claimedRows, error: claimError } = await client
    .from('empty_leg_events_outbox')
    .select('id, leg_id')
    .in('leg_id', parsed.leg_ids)
    .eq('event_type', parsed.event)
    .is('processed_at', null);
  if (claimError) {
    console.error('[match-trigger] outbox claim error', claimError);
  }
  const claimedByLeg: Map<string, string[]> = new Map();
  for (const r of claimedRows ?? []) {
    const list = claimedByLeg.get(r.leg_id) ?? [];
    list.push(r.id);
    claimedByLeg.set(r.leg_id, list);
  }

  const outcomes: MatchOutcome[] = [];
  const rowIdsToMark: string[] = [];

  for (const legId of parsed.leg_ids) {
    const outcome = await matchLeg(legId, parsed.event);
    outcomes.push(outcome);
    if (shouldMarkOutboxProcessed(outcome)) {
      const ids = claimedByLeg.get(legId) ?? [];
      rowIdsToMark.push(...ids);
    }
  }

  await markOutboxRowsProcessed(client, rowIdsToMark);

  return NextResponse.json(
    {
      ok: true,
      total: parsed.leg_ids.length,
      processed: rowIdsToMark.length,
      outcomes,
    },
    { status: 200 }
  );
}
