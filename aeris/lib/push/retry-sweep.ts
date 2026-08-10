import type { DispatchPushArgs } from './fcm-sender';

/**
 * Push retry sweep — pure decision helpers for the
 * `/api/cron/push/retry-sweep` route. No DB access here so the tsx unit
 * suite can cover the row parsing + the redispatch/expire gate without a
 * client.
 *
 * The sweep re-drives `failed_transient` deliveries (PR3a backoff rows)
 * through the SAME dispatcher the matcher uses: the claim RPC inside
 * dispatchClientEmptyLegPush is the concurrency lock (it re-claims only a
 * due retry under the attempt cap), so overlapping sweep runs — or a sweep
 * racing the matcher — can never double-send.
 */

export interface RetryableDeliveryRow {
  id: string;
  client_id: string;
  leg_id: string;
  event_type: 'published' | 'price_dropped';
}

/** Rows come back as SETOF client_push_deliveries through a loose RPC —
 *  drop anything malformed (fail-soft: one bad row must not kill the
 *  sweep). */
export function parseRetryableDeliveries(
  rows: unknown[]
): RetryableDeliveryRow[] {
  const out: RetryableDeliveryRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r.id !== 'string' ||
      typeof r.client_id !== 'string' ||
      typeof r.leg_id !== 'string' ||
      (r.event_type !== 'published' && r.event_type !== 'price_dropped')
    ) {
      continue;
    }
    out.push({
      id: r.id,
      client_id: r.client_id,
      leg_id: r.leg_id,
      event_type: r.event_type,
    });
  }
  return out;
}

export interface SweepLegRow {
  id: string;
  leg_number: string;
  status: string;
  current_price: number | null;
  departure_airport: string | null;
  departure_airport_freeform_snapshot: string | null;
  arrival_airport: string | null;
  arrival_airport_freeform_snapshot: string | null;
}

export type SweepAction =
  | { kind: 'dispatch'; args: DispatchPushArgs }
  | { kind: 'expire'; reason: 'leg_missing' | 'opted_out' | 'leg_unavailable' };

// Same statuses the matcher treats as still-notifiable (matching.ts): a
// booked/expired/cancelled leg must not be pushed hours after the fact.
const REDISPATCHABLE_LEG_STATUSES = new Set(['available', 'reserved']);

/** IATA wins, freeform snapshot second, em-dash placeholder last — the
 *  exact legRouteLabel semantics of the matcher's original send. */
function routeLabel(iata: string | null, freeform: string | null): string {
  if (iata && iata.trim().length > 0) return iata;
  if (freeform && freeform.trim().length > 0) return freeform;
  return '—';
}

/**
 * Decide what to do with one due retry row. `expire` marks the delivery
 * failed_permanent — the world changed since the original attempt (leg gone
 * or client opted out) and retrying would push stale/unwanted content
 * forever.
 */
export function resolveSweepAction(
  delivery: RetryableDeliveryRow,
  leg: SweepLegRow | undefined,
  optedIn: boolean
): SweepAction {
  if (!leg) return { kind: 'expire', reason: 'leg_missing' };
  if (!optedIn) return { kind: 'expire', reason: 'opted_out' };
  if (!REDISPATCHABLE_LEG_STATUSES.has(leg.status)) {
    return { kind: 'expire', reason: 'leg_unavailable' };
  }
  return {
    kind: 'dispatch',
    args: {
      clientId: delivery.client_id,
      legId: delivery.leg_id,
      legNumber: leg.leg_number,
      eventType: delivery.event_type,
      routeFrom: routeLabel(
        leg.departure_airport,
        leg.departure_airport_freeform_snapshot
      ),
      routeTo: routeLabel(
        leg.arrival_airport,
        leg.arrival_airport_freeform_snapshot
      ),
      currentPrice: leg.current_price,
    },
  };
}
