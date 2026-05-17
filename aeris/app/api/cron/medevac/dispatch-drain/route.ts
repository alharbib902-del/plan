import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyCronAuth,
  unauthorizedJsonResponse,
} from '@/lib/empty-legs/cron-auth';
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

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) return unauthorizedJsonResponse();

  const admin = createAdminClient() as unknown as LooseRpcClient;
  const claimId = crypto.randomUUID();

  const { data: claimedRaw, error: claimError } = await admin.rpc(
    'claim_medevac_dispatch_events',
    { p_claim_id: claimId, p_limit: CLAIM_BATCH_SIZE }
  );
  if (claimError) {
    console.error('[medevac.cron.dispatch-drain] claim RPC error', claimError);
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

      // Stamp medevac_requests.dispatched_at on FIRST successful
      // dispatch (gates the sla-escalation cron's measurement
      // window). Atomic conditional UPDATE on dispatched_at IS
      // NULL so subsequent drains (manual_redispatch) don't
      // clobber the original timestamp.
      if (summary.dispatched_operator_ids.length > 0) {
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
            console.error(
              '[medevac.cron.dispatch-drain] dispatched_at stamp failed',
              stampResult.error
            );
          } else {
            summary.dispatched_at_stamped = true;
          }
        } catch (err) {
          console.error(
            '[medevac.cron.dispatch-drain] dispatched_at stamp threw',
            err
          );
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
