import 'server-only';

import { unstable_noStore as noStore } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

/**
 * Phase 10 PR 1 — read helpers for the client `/me/empty-legs/*`
 * surfaces.
 *
 * Same service-role + application-level ownership discipline as
 * me-bookings.ts / me-requests.ts: callers MUST pass
 * `session.client_id` from `requireClientSession()`.
 *
 * Three reads:
 *   - listAvailableEmptyLegs: browse-all tab. All legs with
 *     status='available' AND auction_window_end_at > NOW(),
 *     ordered by current_price ASC.
 *   - listMatchedEmptyLegsForClient: matches tab. JOIN
 *     empty_leg_notifications (client_id-keyed) with empty_legs;
 *     ordered by sent_at DESC.
 *   - getEmptyLegForClient: detail page. UUID-safe lookup
 *     (Codex Phase 9 round 1 PR #57 P2 #1 short-circuit
 *     pattern). Returns NULL on missing/non-UUID input.
 *
 * NOTE: this module returns leg ROWS only — the dispatcher
 * + reservation state lives on the same row and the page
 * components decide how to render based on
 * `reservation_client_id === session.client_id`.
 */

export async function listAvailableEmptyLegs(
  limit = 100
): Promise<EmptyLegRow[]> {
  noStore();
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from('empty_legs')
    .select('*')
    .eq('status', 'available')
    .gt('auction_window_end_at', nowIso)
    .order('current_price', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[me-empty-legs.list-available] read failed', error);
    throw new Error(`listAvailableEmptyLegs failed: ${error.message}`);
  }
  return (data ?? []) as EmptyLegRow[];
}

export interface MatchedEmptyLegEntry {
  notification_id: string;
  notification_sent_at: string;
  notification_event_type: string;
  notification_channel: string;
  leg: EmptyLegRow;
}

export async function listMatchedEmptyLegsForClient(
  clientId: string,
  limit = 50
): Promise<MatchedEmptyLegEntry[]> {
  noStore();
  const admin = createAdminClient();

  // Two-step read: pull notification rows first (keyed on
  // client_id), then load the matching leg rows in one IN query.
  // Avoids the supabase-js relational fetch syntax which requires
  // a fkey alias declared in types/database.ts.
  const { data: notifData, error: notifError } = await admin
    .from('empty_leg_notifications')
    .select('id, leg_id, sent_at, event_type, channel')
    .eq('client_id', clientId)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (notifError) {
    console.error('[me-empty-legs.list-matched] notif read failed', notifError);
    throw new Error(
      `listMatchedEmptyLegsForClient failed (notifications): ${notifError.message}`
    );
  }

  interface RawNotifRow {
    id?: string;
    leg_id?: string;
    sent_at?: string;
    event_type?: string;
    channel?: string;
  }
  const notifRows = (notifData ?? []) as RawNotifRow[];
  if (notifRows.length === 0) return [];

  const legIds: string[] = [];
  for (const n of notifRows) {
    if (typeof n.leg_id === 'string' && n.leg_id.length > 0) {
      legIds.push(n.leg_id);
    }
  }
  if (legIds.length === 0) return [];

  const { data: legData, error: legError } = await admin
    .from('empty_legs')
    .select('*')
    .in('id', legIds);

  if (legError) {
    console.error('[me-empty-legs.list-matched] legs read failed', legError);
    throw new Error(
      `listMatchedEmptyLegsForClient failed (legs): ${legError.message}`
    );
  }

  const legById = new Map<string, EmptyLegRow>();
  for (const r of (legData ?? []) as EmptyLegRow[]) {
    legById.set(r.id, r);
  }

  const out: MatchedEmptyLegEntry[] = [];
  for (const n of notifRows) {
    if (
      typeof n.id !== 'string' ||
      typeof n.leg_id !== 'string' ||
      typeof n.sent_at !== 'string' ||
      typeof n.event_type !== 'string' ||
      typeof n.channel !== 'string'
    ) {
      continue;
    }
    const leg = legById.get(n.leg_id);
    if (!leg) continue; // leg deleted; skip the orphan notification
    out.push({
      notification_id: n.id,
      notification_sent_at: n.sent_at,
      notification_event_type: n.event_type,
      notification_channel: n.channel,
      leg,
    });
  }
  return out;
}

export async function getEmptyLegForClient(
  legId: string
): Promise<EmptyLegRow | null> {
  noStore();
  if (!isUuid(legId)) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('empty_legs')
    .select('*')
    .eq('id', legId)
    .maybeSingle();

  if (error) {
    console.error('[me-empty-legs.detail] read failed', error);
    throw new Error(`getEmptyLegForClient failed: ${error.message}`);
  }
  return (data ?? null) as EmptyLegRow | null;
}

/** Resolves the leg by its public-facing leg_number slug
 *  (e.g., "EL-0001"). Used by /me/empty-legs/[leg_number] page. */
export async function getEmptyLegByNumber(
  legNumber: string
): Promise<EmptyLegRow | null> {
  noStore();
  if (!legNumber || legNumber.trim().length === 0) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('empty_legs')
    .select('*')
    .eq('leg_number', legNumber)
    .maybeSingle();

  if (error) {
    console.error('[me-empty-legs.by-number] read failed', error);
    throw new Error(`getEmptyLegByNumber failed: ${error.message}`);
  }
  return (data ?? null) as EmptyLegRow | null;
}
