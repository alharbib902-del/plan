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

async function markOutboxProcessed(
  legIds: string[],
  eventType: 'published' | 'price_dropped'
): Promise<void> {
  if (legIds.length === 0) return;
  const client = createAdminClient();
  const { error } = await client
    .from('empty_leg_events_outbox')
    .update({ processed_at: new Date().toISOString() })
    .in('leg_id', legIds)
    .eq('event_type', eventType)
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

  const outcomes: MatchOutcome[] = [];
  const toProcess: string[] = [];

  for (const legId of parsed.leg_ids) {
    const outcome = await matchLeg(legId, parsed.event);
    outcomes.push(outcome);
    if (shouldMarkOutboxProcessed(outcome)) {
      toProcess.push(legId);
    }
  }

  await markOutboxProcessed(toProcess, parsed.event);

  return NextResponse.json(
    {
      ok: true,
      total: parsed.leg_ids.length,
      processed: toProcess.length,
      outcomes,
    },
    { status: 200 }
  );
}
