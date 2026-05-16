import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyCronAuth,
  unauthorizedJsonResponse,
} from '@/lib/empty-legs/cron-auth';
import {
  dispatchCargoRequest,
  type CargoDispatchSkipReason,
} from '@/lib/cargo/distribution';
import { notifyOperatorOfCargo } from '@/lib/cargo/notifications';
import { sendFounderCargoBatchAlert } from '@/lib/cargo/founder-batch-email';

/**
 * Phase 11 PR 3 §5 — cargo dispatch drain cron route.
 *
 * Schedule: every 15 minutes (vercel.json).
 * Auth: `Authorization: Bearer $CRON_SECRET` via the shared
 *       Phase 7 verifyCronAuth helper (Round 1+2 PR #72 P1).
 *
 * Drain loop (per spec §5.2, Round 1+2 PR #72 P1 #2 + Round 5
 * PR #72 P2 #1):
 *   1. Generate a per-run claim_id.
 *   2. Call claim_cargo_dispatch_events RPC (atomic UPDATE +
 *      FOR UPDATE SKIP LOCKED inside SECURITY DEFINER).
 *      Returns the rows THIS run owns.
 *   3. For each claimed row:
 *      3.1. dispatchCargoRequest → cargo_request snapshot +
 *           dispatched/skipped per-operator classification.
 *      3.2. notifyOperatorOfCargo for each dispatched operator.
 *      3.3. If dispatched.length === 5, call
 *           sendFounderCargoBatchAlert UNCONDITIONALLY. The
 *           helper owns the atomic founder_batch_alerted_at
 *           throttle.
 *      3.4. Mark processed iff our claim still owns the row
 *           (claim_id = RUN_CLAIM_ID guard).
 *
 * The route writes nothing to the outbox claim_id itself —
 * the RPC stamps it. The mark-processed UPDATE is the only
 * other write the route does.
 */

const CLAIM_BATCH_SIZE = 20;

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        eq: (
          col: string,
          val: unknown
        ) => {
          is: (
            col: string,
            val: unknown
          ) => Promise<{
            data: unknown;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
};

interface ClaimedRow {
  id: string;
  cargo_request_id: string;
  event_type: 'initial' | 'manual_redispatch';
}

interface DispatchResultSummary {
  dispatched_operator_ids?: string[];
  skipped_operator_ids?: string[];
  skip_reasons?: Record<string, CargoDispatchSkipReason>;
  founder_alerted?: boolean;
  // Round 1 PR #73 P1 #2 fix — `request_not_actionable` is
  // permanent (mark processed); `retryable_failure` is set
  // when distribution itself fails (DB read errored), in which
  // case the cron does NOT mark processed so the lease expires
  // and the next tick retries.
  error?: 'request_not_actionable' | 'retryable_failure';
  retry_reason?: string;
  // Round 1 PR #73 P1 #3 fix — wa.me link surfaced here as
  // audit metadata so a founder reviewing the outbox can see
  // which operators received the click-to-chat link even when
  // email failed. NOT a delivery channel by itself.
  whatsapp_links?: Record<string, string>;
}

type LooseUpdateClient = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (
        col: string,
        val: unknown
      ) => {
        eq: (
          col: string,
          val: unknown
        ) => {
          is: (
            col: string,
            val: unknown
          ) => {
            select: (cols: string) => Promise<{
              data: unknown;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
};

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) return unauthorizedJsonResponse();

  const admin = createAdminClient() as unknown as LooseRpcClient;
  const claimId = crypto.randomUUID();

  // Step 2 — atomic claim via SECURITY DEFINER RPC.
  const { data: claimedRaw, error: claimError } = await admin.rpc(
    'claim_cargo_dispatch_events',
    { p_claim_id: claimId, p_limit: CLAIM_BATCH_SIZE }
  );
  if (claimError) {
    console.error('[cargo.cron] claim RPC error', claimError);
    return NextResponse.json(
      { ok: false, error: 'claim_failed' },
      { status: 500 }
    );
  }
  const claimed = (claimedRaw ?? []) as ClaimedRow[];

  let processed = 0;
  let skipped_retry = 0;
  let errors = 0;
  const summaries: Array<{ id: string; summary: DispatchResultSummary }> = [];

  for (const row of claimed) {
    // Step 3.1 — load request + classify operators
    const outcome = await dispatchCargoRequest({
      cargo_request_id: row.cargo_request_id,
      event_type: row.event_type,
    });

    const summary: DispatchResultSummary = {};

    if (!outcome.ok) {
      summary.error = outcome.error;
      if (outcome.error === 'retryable_failure') {
        // Round 1 PR #73 P1 #2 fix — DO NOT mark processed on
        // retryable failures. The 5-minute lease (in
        // cargo_dispatch_events_outbox.claimed_at) expires +
        // the next cron tick reclaims the row.
        summary.retry_reason = outcome.reason;
        summaries.push({ id: row.id, summary });
        skipped_retry += 1;
        continue;
      }
      // request_not_actionable falls through to mark-processed.
    } else {
      summary.dispatched_operator_ids = outcome.dispatched.map(
        (op) => op.operator_id
      );
      summary.skipped_operator_ids = outcome.skipped_operator_ids;
      summary.skip_reasons = outcome.skip_reasons;
      const whatsappLinks: Record<string, string> = {};

      // Step 3.2 — per-operator notify. Round 1 PR #73 P1 #3 fix:
      // wa.me URLs are surfaced into summary.whatsapp_links as
      // audit metadata; only email delivery (or other actively-
      // sent channels) counts as `sent`. If notify.sent is false,
      // the operator moves from dispatched_operator_ids into
      // skipped_operator_ids with skip_reasons[id]='notify_failed'.
      const dispatchedIds = new Set<string>(
        outcome.dispatched.map((op) => op.operator_id)
      );
      for (const op of outcome.dispatched) {
        const notify = await notifyOperatorOfCargo({
          operator_id: op.operator_id,
          operator_email: op.contact_email,
          operator_phone: op.contact_phone,
          cargo_request: outcome.cargo_request,
        });
        if (notify.whatsapp_link_url) {
          whatsappLinks[op.operator_id] = notify.whatsapp_link_url;
        }
        if (!notify.sent) {
          dispatchedIds.delete(op.operator_id);
          summary.skipped_operator_ids = [
            ...(summary.skipped_operator_ids ?? []),
            op.operator_id,
          ];
          summary.skip_reasons = {
            ...(summary.skip_reasons ?? {}),
            [op.operator_id]: 'notify_failed',
          };
        }
      }
      summary.dispatched_operator_ids = Array.from(dispatchedIds);
      if (Object.keys(whatsappLinks).length > 0) {
        summary.whatsapp_links = whatsappLinks;
      }

      // Step 3.3 — founder batch alert at exactly N=5 (post-notify
      // dispatched count). Call unconditionally; helper owns the
      // atomic founder_batch_alerted_at throttle.
      if (summary.dispatched_operator_ids.length === 5) {
        const alert = await sendFounderCargoBatchAlert({
          cargo_request: outcome.cargo_request,
          dispatched_operator_ids: summary.dispatched_operator_ids,
        });
        summary.founder_alerted = alert.sent;
      } else {
        summary.founder_alerted = false;
      }
    }

    summaries.push({ id: row.id, summary });

    // Step 3.4 — mark processed iff we still own the claim.
    // Round 1 PR #73 P2 #4 fix — capture the update result and
    // only count processed when AT LEAST ONE row matched. The
    // claim_id guard may match zero rows after a reclaim race;
    // the Supabase builder reports that via .data being [] (NOT
    // a thrown exception), so the previous try/catch counted
    // those as success.
    const adminUpdate = admin as unknown as LooseUpdateClient;
    let updateError: { message?: string } | null = null;
    let updatedRowCount = 0;
    try {
      const updateResult = await adminUpdate
        .from('cargo_dispatch_events_outbox')
        .update({
          processed_at: new Date().toISOString(),
          dispatch_result: summary,
        })
        .eq('id', row.id)
        .eq('claim_id', claimId)
        .is('processed_at', null)
        .select('id');
      updateError = updateResult.error;
      updatedRowCount = Array.isArray(updateResult.data)
        ? updateResult.data.length
        : 0;
    } catch (err) {
      console.error('[cargo.cron] mark-processed threw', err, {
        outbox_id: row.id,
      });
      errors += 1;
      continue;
    }
    if (updateError || updatedRowCount === 0) {
      console.error('[cargo.cron] mark-processed did not affect a row', {
        outbox_id: row.id,
        claim_id: claimId,
        error: updateError,
        updated: updatedRowCount,
      });
      errors += 1;
      continue;
    }
    processed += 1;
  }

  return NextResponse.json({
    ok: true,
    claim_id: claimId,
    claimed: claimed.length,
    processed,
    skipped_retry,
    errors,
    summaries,
  });
}
