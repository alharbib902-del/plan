import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';

/**
 * Phase 13 PR 3 §6.2 — daily cashback expiry cron.
 *
 * Schedule: once per day (vercel.json `0 4 * * *` — 04:00 UTC =
 * 07:00 Riyadh, 1h after the evaluate-all sweep so any tier
 * change from grace expiry has already landed before we
 * touch the ledger).
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` via the shared
 *       Phase 7 verifyCronAuth helper.
 *
 * Body: single call to `expire_old_loyalty_credits()` (PR 3
 * §4.6 RPC). The RPC loops per-client internally, finds
 * `earn` ledger entries past their `cashback_expiry_at` and
 * posts a compensating `expire` ledger entry that reduces
 * the client's denormalized balance to the lower of:
 *   - current balance minus the sum of expired earns
 *   - current balance (we never go below zero — a client who
 *     redeemed cashback after earning it has nothing left to
 *     expire on that earn).
 *
 * Idempotency: the RPC's WHERE clause excludes clients who
 * already received an `expire` event after the latest
 * `cashback_expiry_at` cutoff, so re-running this route in
 * the same minute is a no-op for those clients.
 *
 * Feature flag: ENABLE_PRIVILEGE='true' required.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type LooseClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

interface ExpireResult {
  ok: boolean;
  clients_processed?: number;
  total_expired_sar?: number;
  errors?: number;
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

  const { data, error } = await client.rpc('expire_old_loyalty_credits', {});
  if (error) {
    console.error('[cron.privilege.expire-cashback] rpc error', error);
    // 200 to keep Vercel Cron from retrying tight; canary will
    // surface the stale `cron_last_run_at`.
    return NextResponse.json(
      { ok: false, error: 'rpc_failed' },
      { status: 200 }
    );
  }

  const result = (data as ExpireResult | null) ?? { ok: false };
  return NextResponse.json(
    {
      ok: result.ok === true,
      clients_processed: result.clients_processed ?? 0,
      total_expired_sar: result.total_expired_sar ?? 0,
      rpc_errors: result.errors ?? 0,
    },
    { status: 200 }
  );
}
