import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyCronAuth,
  unauthorizedJsonResponse,
} from '@/lib/empty-legs/cron-auth';
import { captureCronError } from '@/lib/monitoring/operational';
import {
  dispatchMedevacRequest,
  type MedevacDispatchSkipReason,
} from '@/lib/medevac/distribution';
import { notifyOperatorOfMedevac } from '@/lib/medevac/notifications';

/**
 * Phase 12 PR 3 — medevac dispatch drain cron route.
 *
 * Schedule: every 5 minutes (vercel.json) — tighter than
 * cargo's 15 min because the SLA budget for critical medevac
 * is 1 hour, so the cron + notify round-trip must fit inside
 * a generous fraction of that budget.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` via shared
 *       Phase 7 verifyCronAuth helper.
 *
 * Drain loop (mirror Phase 11 cargo dispatch-drain):
 *   1. Generate a per-run claim_id.
 *   2. claim_medevac_dispatch_events RPC (atomic UPDATE +
 *      FOR UPDATE SKIP LOCKED inside SECURITY DEFINER).
 *   3. For each claimed row:
 *      3.1. dispatchMedevacRequest → request snapshot +
 *           dispatched/skipped per-operator classification
 *           (medical-cert + cert-expiry filtered).
 *      3.2. notifyOperatorOfMedevac for each dispatched
 *           operator — D8 (b) PII redacted (no patient_name).
 *      3.3. Stamp medevac_requests.dispatched_at = NOW() if
 *           it's the first successful dispatch (lets the
 *           sla-escalation cron measure budget against it).
 *      3.4. Mark processed iff our claim still owns the row.
 *
 * No founder batch alert here (cargo has it for "5/5 capped"
 * cases; medevac instead uses sla-escalation which fires
 * when the SLA budget is consumed without an offer).
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
          ) => {
            select: (cols: string) => Promise<{
              data: unknown;
              error: { message?: string } | null;
            }>;
          };
        };
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

interface ClaimedRow {
  id: string;
  medevac_request_id: string;
  event_type: 'initial' | 'manual_redispatch';
}

interface DispatchResultSummary {
  dispatched_operator_ids?: string[];
  skipped_operator_ids?: string[];
  skip_reasons?: Record<string, MedevacDispatchSkipReason>;
  error?: 'request_not_actionable' | 'retryable_failure';
  retry_reason?: string;
  whatsapp_links?: Record<string, string>;
  dispatched_at_stamped?: boolean;
}

// P0 fix (review 2026-06-08) — Vercel Cron invokes scheduled paths via GET;
// a POST-only handler 405s so medevac dispatch never reached operators.
// Expose GET (the scheduler's method) and keep POST for the documented
// manual/curl trigger. Both methods share one handler.
export async function GET(req: NextRequest): Promise<Response> {
  return handler(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handler(req);
}

async function handler(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) return unauthorizedJsonResponse();

  // 2026-06 scope focus — with medevac hidden the drain must be a no-op,
  // not merely unscheduled: a manual/leftover invocation would otherwise
  // email operators about stale outbox rows. Re-enabling the flag resumes
  // draining the backlog unchanged.
  if (process.env.ENABLE_MEDEVAC !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'flag_disabled' });
  }

  const admin = createAdminClient() as unknown as LooseRpcClient;
  const claimId = crypto.randomUUID();

  const { data: claimedRaw, error: claimError } = await admin.rpc(
    'claim_medevac_dispatch_events',
    { p_claim_id: claimId, p_limit: CLAIM_BATCH_SIZE }
  );
  if (claimError) {
    console.error('[medevac.cron.dispatch-drain] claim RPC error', claimError);
    await captureCronError('medevac.dispatch-drain', claimError);
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
    const outcome = await dispatchMedevacRequest({
      medevac_request_id: row.medevac_request_id,
      event_type: row.event_type,
    });

    const summary: DispatchResultSummary = {};

    if (!outcome.ok) {
      summary.error = outcome.error;
      if (outcome.error === 'retryable_failure') {
        summary.retry_reason = outcome.reason;
        summaries.push({ id: row.id, summary });
        skipped_retry += 1;
        continue;
      }
    } else {
      summary.dispatched_operator_ids = outcome.dispatched.map(
        (op) => op.operator_id
      );
      summary.skipped_operator_ids = outcome.skipped_operator_ids;
      summary.skip_reasons = outcome.skip_reasons;
      const whatsappLinks: Record<string, string> = {};

      const dispatchedIds = new Set<string>(
        outcome.dispatched.map((op) => op.operator_id)
      );
      for (const op of outcome.dispatched) {
        const notify = await notifyOperatorOfMedevac({
          operator_id: op.operator_id,
          operator_email: op.contact_email,
          operator_phone: op.contact_phone,
          medevac_request: outcome.medevac_request,
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

      // Round 1 PR #78 P1 #1 fix — if the classifier picked
      // operators but EVERY notify failed (Resend
      // misconfigured / no operator emails / all sends
      // errored), treat the row as retryable so the 5-min
      // lease expires + the next cron tick re-tries. The
      // previous behavior marked the outbox row processed and
      // never stamped dispatched_at, which silently dropped
      // the request out of the sla-escalation cron's scan
      // window (it filters on dispatched_at IS NOT NULL) →
      // pending/offers_received with no retry AND no
      // founder escalation, even for critical severity.
      //
      // Guarded by `outcome.dispatched.length > 0` so a
      // legitimate "no eligible operators" classification
      // (every candidate was skipped via no_capability /
      // recently_dispatched / lower_score) still marks
      // processed — that's a different failure mode the
      // founder can see via the canary card + manual
      // redispatch once new operators sign up. The case
      // we're guarding here is "classifier found candidates
      // but the notify pipeline collapsed."
      if (
        outcome.dispatched.length > 0 &&
        summary.dispatched_operator_ids.length === 0
      ) {
        summary.error = 'retryable_failure';
        summary.retry_reason = 'all_notifications_failed';
        summaries.push({ id: row.id, summary });
        skipped_retry += 1;
        continue;
      }

      // Stamp medevac_requests.dispatched_at on FIRST successful
      // dispatch (gates the sla-escalation cron's measurement
      // window). Atomic conditional UPDATE on dispatched_at IS
      // NULL so subsequent drains (manual_redispatch) don't
      // clobber the original timestamp.
      //
      // Round 2 PR #78 P1 #2 fix — if the stamp fails (transient
      // DB / PostgREST error) we now treat the WHOLE outbox row
      // as retryable: leave it unprocessed so the next 5-min
      // tick retries the stamp before the row escapes the
      // sla-escalation cron's filter (dispatched_at IS NOT NULL).
      // Previous behavior logged + continued + marked processed,
      // creating a notified-but-invisible-to-SLA request on any
      // transient failure. We treat "0 rows affected" as success
      // too — that's the legitimate already-stamped case
      // (manual_redispatch on an earlier-dispatched request).
      if (summary.dispatched_operator_ids.length > 0) {
        let stampFailed = false;
        let stampErrorMsg = '';
        try {
          const stampResult = await admin
            .from('medevac_requests')
            .update({
              dispatched_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.medevac_request_id)
            .is('dispatched_at', null);
          if (
            stampResult &&
            typeof stampResult === 'object' &&
            'error' in stampResult &&
            stampResult.error
          ) {
            stampFailed = true;
            stampErrorMsg = String(
              stampResult.error?.message ?? 'unknown'
            );
            console.error(
              '[medevac.cron.dispatch-drain] dispatched_at stamp failed',
              stampResult.error
            );
          } else {
            summary.dispatched_at_stamped = true;
          }
        } catch (err) {
          stampFailed = true;
          stampErrorMsg =
            err instanceof Error ? err.message : String(err);
          console.error(
            '[medevac.cron.dispatch-drain] dispatched_at stamp threw',
            err
          );
        }

        if (stampFailed) {
          summary.error = 'retryable_failure';
          summary.retry_reason = `dispatched_at_stamp_failed: ${stampErrorMsg.slice(0, 200)}`;
          summaries.push({ id: row.id, summary });
          skipped_retry += 1;
          continue;
        }
      }
    }

    summaries.push({ id: row.id, summary });

    // Mark processed iff we still own the claim.
    let updateError: { message?: string } | null = null;
    let updatedRowCount = 0;
    try {
      const updateResult = await admin
        .from('medevac_dispatch_events_outbox')
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
      console.error('[medevac.cron.dispatch-drain] mark-processed threw', err, {
        outbox_id: row.id,
      });
      errors += 1;
      continue;
    }
    if (updateError || updatedRowCount === 0) {
      console.error(
        '[medevac.cron.dispatch-drain] mark-processed did not affect a row',
        {
          outbox_id: row.id,
          claim_id: claimId,
          error: updateError,
          updated: updatedRowCount,
        }
      );
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
