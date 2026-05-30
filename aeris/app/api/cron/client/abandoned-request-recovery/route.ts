import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { listStaleOfferedRequests } from '@/lib/clients/request-recovery';
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
    requests = await listStaleOfferedRequests(STALE_HOURS, 500);
  } catch (err) {
    console.error('[cron.request-recovery] load failed', err);
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 200 });
  }

  const rpc = createAdminClient() as unknown as LooseRpcClient;
  let sent = 0;
  let skipped = 0;

  for (const request of requests) {
    const client = request.clients;
    if (!client) continue;

    // Atomic claim BEFORE sending — only the run that wins the unique
    // (trip_request_id) row sends; no duplicate reminder even if two runs overlap.
    const { data: claimId, error: claimErr } = await rpc.rpc(
      'record_trip_request_recovery_reminder',
      { p_trip_request_id: request.id, p_client_id: client.id, p_channel: 'email' }
    );
    if (claimErr) {
      console.error('[cron.request-recovery] claim failed', { request: request.id, err: claimErr });
      continue;
    }
    if (!claimId) {
      skipped += 1; // already reminded
      continue;
    }

    const result = await sendClientRequestRecoveryEmail({
      client: {
        id: client.id,
        full_name: client.full_name,
        auth_email: client.auth_email,
      },
      requestNumber: request.request_number,
      routeFrom: request.departure_airport ?? '—',
      routeTo: request.arrival_airport ?? '—',
      requestUrl: `${siteBaseUrl()}/me/requests/${request.id}`,
    });

    if (!result.ok) {
      // Release the claim so the next run retries (transient / env-missing send).
      await rpc.rpc('delete_trip_request_recovery_reminder', { p_reminder_id: claimId });
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
