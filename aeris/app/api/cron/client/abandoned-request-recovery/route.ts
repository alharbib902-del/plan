import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { listRecoverableRequests } from '@/lib/clients/request-recovery';
import { sendClientRequestRecoveryEmail } from '@/lib/notifications/client-request-recovery-email';

/**
 * Abandoned trip-request recovery cron.
 *
 * Schedule: daily (vercel.json). Finds client-owned trip_requests stuck at
 * `offered` (operators have made offers) older than STALE_HOURS without a
 * booking, and emails the client once to come back and complete the booking.
 *
 * Dedup is per request via a CLAIM-before-send: record_trip_request_recovery_
 * reminder (INSERT ... ON CONFLICT (trip_request_id) DO NOTHING RETURNING id)
 * runs FIRST, so only one run can ever send; on a send failure the claim is
 * released (delete_trip_request_recovery_reminder) so the next run retries.
 *
 * Auth: shared CRON_SECRET (Authorization: Bearer …) — Vercel Cron sets it.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const STALE_HOURS = 24;

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aeris.sa').replace(/\/$/, '');
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  let requests;
  try {
    // Candidates already exclude reminded requests (anti-join in the RPC) BEFORE
    // the limit, so newer requests are never starved by old reminded ones.
    requests = await listRecoverableRequests(STALE_HOURS, 500);
  } catch (err) {
    console.error('[cron.request-recovery] load failed', err);
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 200 });
  }

  const rpc = createAdminClient() as unknown as LooseRpcClient;
  let sent = 0;
  let skipped = 0;

  for (const c of requests) {
    // Atomic claim BEFORE sending — only the run that wins the unique
    // (trip_request_id) row sends; no duplicate reminder even if two runs overlap.
    // (client_id is derived inside the RPC from the request itself.)
    const { data: claimId, error: claimErr } = await rpc.rpc(
      'record_trip_request_recovery_reminder',
      { p_trip_request_id: c.trip_request_id, p_channel: 'email' }
    );
    if (claimErr) {
      console.error('[cron.request-recovery] claim failed', { request: c.trip_request_id, err: claimErr });
      continue;
    }
    if (!claimId) {
      skipped += 1; // already reminded / became ineligible
      continue;
    }

    const result = await sendClientRequestRecoveryEmail({
      client: {
        id: c.client_id,
        full_name: c.client_full_name,
        auth_email: c.client_auth_email,
      },
      requestNumber: c.request_number,
      routeFrom: c.departure_airport ?? '—',
      routeTo: c.arrival_airport ?? '—',
      requestUrl: `${siteBaseUrl()}/me/requests/${c.trip_request_id}`,
    });

    if (!result.ok) {
      // Release the claim so the next run retries (transient / env-missing send).
      const { error: releaseErr } = await rpc.rpc('delete_trip_request_recovery_reminder', {
        p_reminder_id: claimId,
      });
      if (releaseErr) {
        console.error('[cron.request-recovery] release claim failed', {
          request: c.trip_request_id,
          err: releaseErr,
        });
      }
      skipped += 1;
      continue;
    }
    sent += 1;
  }

  return NextResponse.json(
    { ok: true, candidates: requests.length, sent, skipped },
    { status: 200 }
  );
}
