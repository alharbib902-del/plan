import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { captureCronError } from '@/lib/monitoring/operational';
import { sentryEnabled } from '@/lib/monitoring/sentry-options';

/**
 * P2 ops — daily cashback-drift detector (REPORT-ONLY).
 *
 * Schedule: once per day (vercel.json `0 6 * * *` — 06:00 UTC =
 * 09:00 Riyadh, after the 03:00 evaluate-all + 04:00 expire-cashback
 * sweeps have settled the ledger, so we compare a steady state).
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` via the shared Phase 7
 *       verifyCronAuth helper (constant-time, fail-closed).
 *
 * Why: `clients.cashback_balance_sar` is a DENORMALIZED cache of the
 * per-client `client_loyalty_ledger` sum. Triggers keep them in step,
 * but an admin balance edit, a partial-replay, or a future bug could
 * let the cache drift from the ledger. The `reconcile_client_cashback_balance`
 * RPC already detects this per client (PR 13.3 §4.x, REPORT-ONLY) but
 * nothing was scheduled to RUN it — so drift would sit silent. This
 * route closes that gap: it scans clients, asks the RPC for each
 * client's `drift_sar`, and ALERTS when any are non-zero. It NEVER
 * writes a balance — correction stays a deliberate human action.
 *
 * Body:
 *   1. Auth + flag check.
 *   2. Claim up to BATCH_LIMIT clients ordered by id (deterministic,
 *      so a stuck row surfaces the same way each run).
 *   3. For each, call `reconcile_client_cashback_balance(p_client_id)`
 *      sequentially (cron-style: avoids piling concurrent SECURITY
 *      DEFINER calls on the clients/ledger relations).
 *   4. Count rows where `drift_sar <> 0`, keep a bounded SAMPLE for
 *      triage, and if any drifted, capture a Sentry MESSAGE at
 *      severity `warning` + `console.warn`.
 *
 * Failure handling: the claim query and a hard RPC error are
 * run-aborting, so they go to `captureCronError` (level error) and
 * return 200 (Vercel Cron must not retry-storm). A single bad row's
 * RPC error is counted + logged, not fatal, matching evaluate-all.
 *
 * Feature flag: ENABLE_PRIVILEGE='true' required (cashback is a
 * Privilege-subsystem concern). When OFF, returns 200
 * `{ ok: true, skipped: 'flag_disabled' }` so Vercel Cron doesn't retry.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

// Bounded so one slow run can't fan out unbounded sequential RPCs.
// The denormalized-balance population is the privilege client set,
// which is small; raise this only if the client count outgrows it
// (a stuck high-id tail would otherwise never be reached).
const BATCH_LIMIT = 500;
// Cap on how many drifted clients we attach to the alert, so a
// systemic drift can't bloat the Sentry event / log line.
const SAMPLE_LIMIT = 20;

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => {
        limit: (n: number) => Promise<{
          data: unknown;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

interface ClientRow {
  id: string;
}

interface ReconcileResult {
  ok: boolean;
  client_id?: string;
  denormalized_balance_sar?: number;
  ledger_sum_sar?: number;
  drift_sar?: number;
  in_sync?: boolean;
  error?: string;
}

interface DriftSample {
  client_id: string;
  denormalized_balance_sar: number;
  ledger_sum_sar: number;
  drift_sar: number;
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

  // Step 1: claim a deterministic batch of clients to reconcile.
  const { data: claimed, error: claimErr } = await client
    .from('clients')
    .select('id')
    .order('id', { ascending: true })
    .limit(BATCH_LIMIT);

  if (claimErr) {
    console.error('[cron.privilege.cashback-drift-check] claim error', claimErr);
    await captureCronError('privilege.cashback-drift-check', claimErr);
    // 200 (not 5xx) so Vercel Cron doesn't retry-storm; the stale
    // cron_last_run_at canary surfaces a persistent failure.
    return NextResponse.json(
      { ok: false, error: 'claim_failed' },
      { status: 200 }
    );
  }

  const rows = (claimed ?? []) as ClientRow[];

  let checked = 0;
  let drifted = 0;
  let errors = 0;
  const sample: DriftSample[] = [];

  for (const row of rows) {
    try {
      const { data, error } = await client.rpc(
        'reconcile_client_cashback_balance',
        { p_client_id: row.id }
      );
      if (error) {
        errors += 1;
        console.error('[cron.privilege.cashback-drift-check] rpc error', {
          client_id: row.id,
          error,
        });
        continue;
      }

      const result = (data as ReconcileResult | null) ?? { ok: false };
      checked += 1;
      if (!result.ok) {
        // e.g. client_not_found from a race with a deletion — count,
        // don't alert (it's not a balance-drift signal).
        errors += 1;
        continue;
      }

      const drift = Number(result.drift_sar ?? 0);
      if (drift !== 0) {
        drifted += 1;
        if (sample.length < SAMPLE_LIMIT) {
          sample.push({
            client_id: row.id,
            denormalized_balance_sar: Number(result.denormalized_balance_sar ?? 0),
            ledger_sum_sar: Number(result.ledger_sum_sar ?? 0),
            drift_sar: drift,
          });
        }
      }
    } catch (err) {
      errors += 1;
      console.error('[cron.privilege.cashback-drift-check] throw', {
        client_id: row.id,
        err,
      });
    }
  }

  // Alert ONLY when drift is present. Report-only: we never correct a
  // balance here — surfacing it for a human to investigate is the job.
  if (drifted > 0) {
    console.warn('[cron.privilege.cashback-drift-check] DRIFT DETECTED', {
      checked,
      drifted,
      sample,
    });
    Sentry.captureMessage(
      `cashback balance drift detected: ${drifted} of ${checked} clients out of sync with the loyalty ledger`,
      {
        level: 'warning',
        tags: { cron: 'privilege.cashback-drift-check', operational: true },
        extra: { checked, drifted, sample },
      }
    );
    // Mirror captureCronError's flush discipline: a cron handler can
    // return before a buffered event ships, so push it out when a DSN
    // is set — wrapped so a flush failure can never break the run.
    if (sentryEnabled()) {
      try {
        await Sentry.flush(1500);
      } catch {
        // A flush timeout / transport failure must never break the cron run.
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      checked,
      drifted,
      errors,
      ...(drifted > 0 ? { sample } : {}),
    },
    { status: 200 }
  );
}
