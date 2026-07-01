import { NextRequest, NextResponse } from 'next/server';

import { isClientOptedIn } from '@/lib/clients/notification-preferences';
import { flagOn } from '@/lib/config/feature-flags';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';
import { captureCronError } from '@/lib/monitoring/operational';
import {
  listRetryablePushDeliveries,
  markPushDelivery,
} from '@/lib/push/deliveries';
import {
  parseRetryableDeliveries,
  resolveSweepAction,
  type SweepLegRow,
} from '@/lib/push/retry-sweep';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Push retry-sweep cron.
 *
 * Schedule: every 20 minutes (vercel.json) — inside the PR3a backoff curve
 * (5m → 6h cap, 5 attempts). Without this sweep a `failed_transient`
 * delivery (FCM 5xx, creds missing at send time, OAuth mint failure) would
 * sit in client_push_deliveries FOREVER: the matcher only dispatches on
 * fresh match events, and nothing else re-reads the retry log.
 *
 * For each due row (list_retryable_push_deliveries):
 *   - leg deleted / no longer available|reserved → mark failed_permanent
 *     (pushing a stale leg hours later is worse than silence);
 *   - client since opted out of empty_legs.push → mark failed_permanent;
 *   - otherwise re-drive dispatchClientEmptyLegPush. The claim RPC inside
 *     the dispatcher is the concurrency lock (re-claims only a due retry
 *     under the attempt cap), so overlapping sweeps or a sweep racing the
 *     matcher can never double-send. The dispatcher is fail-soft and never
 *     throws.
 *
 * Flag: ENABLE_PUSH_NOTIFICATIONS (fail-closed) — a disabled channel keeps
 * its backlog untouched so retries resume when the flag flips on.
 * Auth: shared CRON_SECRET (Authorization: Bearer …) — Vercel Cron sets it.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const SWEEP_BATCH_LIMIT = 100;

type LooseDbClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (
        col: string,
        values: string[]
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
  };
};

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  if (!flagOn('ENABLE_PUSH_NOTIFICATIONS')) {
    return NextResponse.json(
      { ok: true, skipped: 'flag_disabled' },
      { status: 200 }
    );
  }

  const deliveries = parseRetryableDeliveries(
    await listRetryablePushDeliveries(SWEEP_BATCH_LIMIT)
  );
  if (deliveries.length === 0) {
    return NextResponse.json(
      { ok: true, due: 0, redispatched: 0, expired: 0 },
      { status: 200 }
    );
  }

  const legIds = [...new Set(deliveries.map((d) => d.leg_id))];
  const clientIds = [...new Set(deliveries.map((d) => d.client_id))];
  const db = createAdminClient() as unknown as LooseDbClient;

  let legRows: unknown;
  let clientRows: unknown;
  try {
    const [legsRes, clientsRes] = await Promise.all([
      db
        .from('empty_legs')
        .select(
          'id, leg_number, status, current_price, departure_airport, departure_airport_freeform_snapshot, arrival_airport, arrival_airport_freeform_snapshot'
        )
        .in('id', legIds),
      db
        .from('clients')
        .select('id, notification_preferences')
        .in('id', clientIds),
    ]);
    if (legsRes.error || clientsRes.error) {
      throw new Error(
        legsRes.error?.message ?? clientsRes.error?.message ?? 'load_failed'
      );
    }
    legRows = legsRes.data;
    clientRows = clientsRes.data;
  } catch (err) {
    console.error('[cron.push-retry-sweep] context load failed', err);
    await captureCronError('push.retry-sweep', err);
    return NextResponse.json(
      { ok: false, error: 'load_failed' },
      { status: 200 }
    );
  }

  const legsById = new Map<string, SweepLegRow>(
    (Array.isArray(legRows) ? (legRows as SweepLegRow[]) : []).map((leg) => [
      leg.id,
      leg,
    ])
  );
  const prefsByClient = new Map<string, Record<string, unknown> | null>(
    (Array.isArray(clientRows)
      ? (clientRows as {
          id: string;
          notification_preferences: Record<string, unknown> | null;
        }[])
      : []
    ).map((c) => [c.id, c.notification_preferences])
  );

  // Lazy-load the sender AFTER the flag/backlog checks — keeps google-auth
  // out of the module graph on no-op runs (same pattern as the matcher).
  const { dispatchClientEmptyLegPush } = await import('@/lib/push/fcm-sender');

  let redispatched = 0;
  let expired = 0;

  for (const delivery of deliveries) {
    const optedIn = isClientOptedIn(
      prefsByClient.get(delivery.client_id),
      'empty_legs',
      'push'
    );
    const action = resolveSweepAction(
      delivery,
      legsById.get(delivery.leg_id),
      optedIn
    );
    if (action.kind === 'expire') {
      // Marked WITHOUT claiming: if a matcher-driven dispatch races us and
      // wins the claim, its final mark simply overwrites this one (and a
      // 'sent' can never be downgraded server-side) — benign either way.
      await markPushDelivery(delivery.id, 'failed_permanent', {
        lastError: `sweep_${action.reason}`,
      });
      expired += 1;
      continue;
    }
    await dispatchClientEmptyLegPush(action.args);
    redispatched += 1;
  }

  return NextResponse.json(
    { ok: true, due: deliveries.length, redispatched, expired },
    { status: 200 }
  );
}
