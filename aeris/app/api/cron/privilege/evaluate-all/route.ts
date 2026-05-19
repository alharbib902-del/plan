import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';

/**
 * Phase 13 PR 3 §6.1 — daily evaluate-all cron.
 *
 * Schedule: once per day (vercel.json `0 3 * * *` — 03:00 UTC =
 * 06:00 Riyadh, before business hours so a downgrade lands
 * before the client opens the dashboard).
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` via the shared
 *       Phase 7 verifyCronAuth helper.
 *
 * Why a cron at all (the AFTER trigger already runs evaluate
 * on every paid booking):
 *
 *   1. Grace expiry (D6). A client whose 12-month qualifying
 *      spend dropped below their tier threshold gets
 *      `privilege_below_threshold_since` stamped on the next
 *      paid booking — but if they make NO further bookings,
 *      the 90-day grace clock would never re-evaluate without
 *      this sweep. The cron catches them on the first run
 *      after grace expires and triggers the one-step downgrade.
 *
 *   2. Tier-up drift (very rare). The trigger evaluates on
 *      paid bookings only; refunds + admin balance edits
 *      could shift the qualified spend without firing a
 *      booking-triggered evaluate. Daily sweep covers the gap.
 *
 * Body:
 *   1. Auth check.
 *   2. Read up to BATCH_LIMIT non-silver clients ordered by
 *      privilege_tier_assigned_at ASC (oldest evaluated first).
 *      We do NOT process silver clients because their grace
 *      flag is meaningless (there's nothing below silver).
 *   3. For each, call `evaluate_client_privilege_tier(client_id)`
 *      one at a time (cron-style: sequential to avoid contention
 *      on the clients lock if multiple grace expirations land in
 *      the same batch).
 *   4. Aggregate results into a JSON summary for canary triage.
 *
 * Failure handling: each evaluate call is wrapped in try/catch
 * so one bad row doesn't abort the entire sweep. Errors are
 * counted + logged for follow-up.
 *
 * Feature flag: ENABLE_PRIVILEGE='true' required. When OFF, the
 * route returns 200 `{ ok: true, skipped: 'flag_disabled' }` so
 * Vercel Cron doesn't retry it.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const BATCH_LIMIT = 200;

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      neq: (
        col: string,
        val: unknown
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean; nullsFirst?: boolean }
        ) => {
          limit: (n: number) => Promise<{
            data: unknown;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

interface CandidateRow {
  id: string;
  privilege_tier: 'silver' | 'gold' | 'platinum' | 'diamond';
  privilege_tier_assigned_at: string | null;
  privilege_below_threshold_since: string | null;
}

interface EvalResult {
  ok: boolean;
  tier_action?: string;
  from_tier?: string;
  to_tier?: string;
  error?: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  if (process.env.ENABLE_PRIVILEGE !== 'true') {
    return NextResponse.json(
      { ok: true, skipped: 'flag_disabled' },
      { status: 200 }
    );
  }

  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  const client = createAdminClient() as unknown as LooseClient;

  // Step 1: claim a batch of non-silver clients sorted by the
  // oldest evaluation timestamp. NULL goes first so freshly
  // migrated rows get evaluated before stale ones.
  const { data: candidates, error: claimErr } = await client
    .from('clients')
    .select('id, privilege_tier, privilege_tier_assigned_at, privilege_below_threshold_since')
    .neq('privilege_tier', 'silver')
    .order('privilege_tier_assigned_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);

  if (claimErr) {
    console.error('[cron.privilege.evaluate-all] claim error', claimErr);
    // Same convention as match-drain: don't 5xx so Vercel Cron
    // doesn't compound load with a retry.
    return NextResponse.json(
      { ok: false, error: 'claim_failed' },
      { status: 200 }
    );
  }

  const rows = (candidates ?? []) as CandidateRow[];
  if (rows.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        claimed: 0,
        evaluated: 0,
        actions: { upgrade: 0, downgrade_one_step: 0, no_change: 0, other: 0 },
        errors: 0,
      },
      { status: 200 }
    );
  }

  let evaluated = 0;
  let errors = 0;
  const actionCounts = {
    upgrade: 0,
    downgrade_one_step: 0,
    start_grace: 0,
    grace_in_progress: 0,
    locked_no_action: 0,
    no_change: 0,
    other: 0,
  };

  for (const row of rows) {
    try {
      const { data, error } = await client.rpc('evaluate_client_privilege_tier', {
        p_client_id: row.id,
        p_source_booking_id: null,
      });
      if (error) {
        errors += 1;
        console.error(
          '[cron.privilege.evaluate-all] rpc error',
          { client_id: row.id, error }
        );
        continue;
      }
      const result = data as EvalResult;
      evaluated += 1;
      if (!result.ok) {
        errors += 1;
        continue;
      }
      const action = result.tier_action ?? 'other';
      if (action in actionCounts) {
        (actionCounts as Record<string, number>)[action] += 1;
      } else {
        actionCounts.other += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(
        '[cron.privilege.evaluate-all] throw',
        { client_id: row.id, err }
      );
    }
  }

  return NextResponse.json(
    {
      ok: true,
      claimed: rows.length,
      evaluated,
      actions: actionCounts,
      errors,
    },
    { status: 200 }
  );
}
