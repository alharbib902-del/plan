import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import {
  listActiveAlertsWithClient,
  findMatchingAvailableLegs,
  listDeliveredLegIds,
} from '@/lib/empty-legs/alerts';
import { sendClientEmptyLegMatchEmail } from '@/lib/notifications/client-empty-leg-email';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

/**
 * Empty Legs price-alerts cron.
 *
 * Schedule: hourly (vercel.json). For each ACTIVE client alert, find `available`
 * legs matching its IATA route + optional price cap + optional date window. For
 * each match, CLAIM the (alert, leg) delivery atomically FIRST
 * (record_empty_leg_alert_delivery — INSERT ... ON CONFLICT DO NOTHING RETURNING
 * id) so only one run can ever send; email the client only on a won claim; on a
 * send failure, release the claim (delete_empty_leg_alert_delivery) so the next
 * run retries. No duplicate email even if two cron invocations overlap.
 * (listDeliveredLegIds is only a cheap pre-filter, not the lock.)
 *
 * Auth: shared CRON_SECRET (Authorization: Bearer …) — Vercel Cron sets it.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

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

  let alerts;
  try {
    alerts = await listActiveAlertsWithClient(500);
  } catch (err) {
    console.error('[cron.price-alerts] load alerts failed', err);
    return NextResponse.json({ ok: false, error: 'load_failed' }, { status: 200 });
  }

  const rpc = createAdminClient() as unknown as LooseRpcClient;
  let matched = 0;
  let sent = 0;
  let skipped = 0;

  for (const alert of alerts) {
    const client = alert.clients;
    if (!client) continue;

    let legs: EmptyLegRow[] = [];
    let delivered: Set<string> = new Set();
    try {
      [legs, delivered] = await Promise.all([
        findMatchingAvailableLegs(alert),
        listDeliveredLegIds(alert.id),
      ]);
    } catch (err) {
      console.error('[cron.price-alerts] match failed', { alert: alert.id, err });
      continue;
    }

    for (const leg of legs) {
      if (delivered.has(leg.id)) continue; // cheap pre-filter; the claim below is the lock
      matched += 1;

      // Atomic claim BEFORE sending: INSERT ... ON CONFLICT DO NOTHING RETURNING id.
      // Only the run that wins the unique (alert, leg) row sends — no duplicate email
      // even if two cron invocations overlap.
      const { data: claimId, error: claimErr } = await rpc.rpc(
        'record_empty_leg_alert_delivery',
        { p_alert_id: alert.id, p_empty_leg_id: leg.id, p_channel: 'email' }
      );
      if (claimErr) {
        console.error('[cron.price-alerts] claim failed', {
          alert: alert.id,
          leg: leg.id,
          err: claimErr,
        });
        continue;
      }
      if (!claimId) {
        skipped += 1; // already claimed / delivered
        continue;
      }

      const result = await sendClientEmptyLegMatchEmail({
        client: {
          id: client.id,
          full_name: client.full_name,
          auth_email: client.auth_email,
          contact_phone: client.contact_phone,
        },
        leg,
        eventType: 'published',
        legUrl: `${siteBaseUrl()}/me/empty-legs/${leg.leg_number}`,
      });

      if (!result.ok) {
        // Release the claim so the next run retries (transient / env-missing send).
        await rpc.rpc('delete_empty_leg_alert_delivery', { p_delivery_id: claimId });
        skipped += 1;
        continue;
      }
      sent += 1;
    }
  }

  return NextResponse.json(
    { ok: true, alerts: alerts.length, matched, sent, skipped },
    { status: 200 }
  );
}
