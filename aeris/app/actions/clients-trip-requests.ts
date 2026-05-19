'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { fireAndForgetTripDispatch } from '@/lib/automation/trip-dispatch-fire';
import { redeemCashbackIfRequested } from '@/lib/privilege/redeem-helper';
import {
  createTripRequestSchema,
  cancelTripRequestSchema,
  acceptOfferSchema,
  declineOfferSchema,
} from '@/lib/validators/clients';

/**
 * Phase 9 PR 2 + PR 3 — authenticated trip-request Server
 * Actions for the /me/* surface.
 *
 * 4 actions in this module:
 *   - createAuthenticatedTripRequest (PR 2) — wraps the §4.2 RPC.
 *     Optionally fires the auto-dispatch trigger, gated by
 *     ENABLE_TRIP_AUTO_DISTRIBUTION === 'true' (default off
 *     until PR 4 + probes 16 + 17 pass).
 *   - cancelMyTripRequest (PR 2) — single conditional UPDATE
 *     that enforces ownership AND status guard inside the
 *     SQL WHERE clause. Zero rows → opaque cancel_not_allowed.
 *   - clientAcceptOffer (PR 3) — pre-SELECTs the offer's parent
 *     trip ownership against session.client_id, then calls the
 *     existing Phase 5/6 `accept_offer(p_source, p_offer_id)`
 *     RPC unchanged (spec Decision #8 — admin-callable RPC
 *     stays as-is).
 *   - clientDeclineOffer (PR 3) — single conditional UPDATE on
 *     the right offer table with three guards ANDed in the
 *     WHERE clause (trip ownership, offer status='pending',
 *     parent trip status IN ('distributed','offered'); spec
 *     round 4 P1 #2). Zero rows → opaque decline_not_allowed.
 *
 * Mirrors PR 1 client-action discipline (Phase 9 conventions
 * #1 looseClient + #6 opaque errors + #9 structured contract
 * codes).
 */

export type ClientTripActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

// Codex round 1 PR #55 P2 #2 carry-over: fail-closed flag.
function isPortalDisabled(): boolean {
  return process.env.ENABLE_CLIENT_PORTAL !== 'true';
}

function isAutoDistributionEnabled(): boolean {
  return process.env.ENABLE_TRIP_AUTO_DISTRIBUTION === 'true';
}

function fieldErrorsFromZod(
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.');
    if (path) out[path] = issue.message;
  }
  return out;
}

// Phase 9 PR 1 carry-over (convention #1): no Functions map
// entry for the new RPC. Every .rpc() call goes through this
// loose-typed accessor that preserves the Supabase JS
// internal `this` binding (Phase 8 PR 2e #51 fix).
type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

function looseClient(): LooseRpcClient {
  return createAdminClient() as unknown as LooseRpcClient;
}

// ============================================================
// 1. createAuthenticatedTripRequest
// ============================================================

export type CreateAuthenticatedTripRequestResult =
  | { ok: true; trip_request_id: string; request_number: string }
  | ClientTripActionFailure;

export async function createAuthenticatedTripRequest(input: {
  legs: Array<{
    from: string;
    to: string;
    date: string;
    time?: string | null;
  }>;
  departure_iata: string;
  arrival_iata: string;
  departure_date: string;
  return_date?: string | null;
  passengers: number;
  aircraft_pref?:
    | 'light'
    | 'mid'
    | 'super_mid'
    | 'heavy'
    | 'long_range'
    | null;
  special_requests?: string | null;
}): Promise<CreateAuthenticatedTripRequestResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

  const parsed = createTripRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc(
    'create_authenticated_trip_request',
    {
      p_client_id: session.client_id,
      p_trip_type: 'charter',
      p_legs: parsed.data.legs,
      p_departure_iata: parsed.data.departure_iata.toUpperCase(),
      p_arrival_iata: parsed.data.arrival_iata.toUpperCase(),
      p_departure_date: parsed.data.departure_date,
      p_return_date: parsed.data.return_date ?? null,
      p_passengers: parsed.data.passengers,
      p_aircraft_pref: parsed.data.aircraft_pref ?? null,
      p_special_requests: parsed.data.special_requests ?? null,
    }
  );

  if (error) {
    console.error(
      '[clients-trip-requests.createAuthenticatedTripRequest] rpc error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; trip_request_id: string; request_number: string }
    | { ok: false; error: string };

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Auto-dispatch trigger — gated. PR 4 ships the matching
  // endpoint; until then the flag stays off and this branch
  // is dead code in production. Phase 9 spec §5 PR 2 + spec
  // round 1 P1 #3 alignment: default-off, founder flips after
  // probes 16 + 17.
  if (isAutoDistributionEnabled()) {
    fireAndForgetTripDispatch(result.trip_request_id);
  }

  // Refresh the requests list (PR 3 surface) so a follow-up
  // /me/requests render shows the new row immediately.
  revalidatePath('/me/requests');
  revalidatePath('/me/charter');

  return {
    ok: true,
    trip_request_id: result.trip_request_id,
    request_number: result.request_number,
  };
}

// ============================================================
// 2. cancelMyTripRequest
// ============================================================
//
// Single conditional UPDATE that asserts BOTH ownership AND
// status guard inside the SQL WHERE clause (Phase 9 spec §5
// PR 2 — Codex round 4 P1 #1 + round 5 P2 #2 simplification).
// A status='booked' trip MUST NOT be cancellable from this
// Server Action; the booking-cancellation flow lives
// separately in admin (Phase 10 client-side scope).
//
// Single result shape (Codex round 5 P2 #2 fix): zero rows
// returned → opaque `cancel_not_allowed`. The earlier
// `already_cancelled` branch was unreachable because a
// cancelled row also fails the WHERE predicate, returning
// zero rows indistinguishably from booked / cross-owner /
// not-found. Matches Phase 8 `leg_not_found` discipline.

export type CancelMyTripRequestResult =
  | { ok: true; trip_request_id: string }
  | ClientTripActionFailure;

export async function cancelMyTripRequest(input: {
  trip_request_id: string;
}): Promise<CancelMyTripRequestResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

  const parsed = cancelTripRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('trip_requests')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.trip_request_id)
    .eq('client_id', session.client_id)
    .in('status', ['pending', 'distributed', 'offered'])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(
      '[clients-trip-requests.cancelMyTripRequest] update error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (!data) {
    // Opaque single-error model (Phase 9 spec §5 PR 2). Could
    // be: trip not owned by this client, or trip in
    // booked/cancelled status, or trip id not found. Never
    // leak which guard tripped.
    return { ok: false, error: 'cancel_not_allowed' };
  }

  revalidatePath('/me/requests');
  revalidatePath(`/me/requests/${parsed.data.trip_request_id}`);

  return { ok: true, trip_request_id: parsed.data.trip_request_id };
}

// ============================================================
// 3. clientAcceptOffer (Phase 9 PR 3)
// ============================================================
//
// Phase 9 spec Decision #8: the existing `accept_offer` RPC
// stays unchanged (admin-callable). PR 3 wires a client-callable
// Server Action that:
//   1. Pre-SELECTs the offer's parent trip and asserts it is
//      owned by the calling client (defence-in-depth — the
//      RPC itself is admin-scope; without this check the
//      service-role escalation would let any client accept
//      any other client's offer once they got an offer_id).
//   2. Calls accept_offer(source, offer_id) unchanged.
//   3. Revalidates /me/requests + /me/requests/[id] paths so
//      the freshly-booked trip + new booking row land on the
//      client's surfaces immediately.

/**
 * Phase 13 PR 3 — accept response now carries an optional
 * `cashback_redemption` field. Populated only when the caller
 * passed `cashback_redemption_sar > 0`. The outer `ok: true`
 * is preserved even on redeem failure (the booking is created;
 * UI surfaces a soft warning if redeem.ok === false).
 */
export type ClientAcceptOfferResult =
  | {
      ok: true;
      trip_request_id: string;
      booking_id: string | null;
      cashback_redemption?:
        | { ok: true; redeemed_sar: number; new_balance_sar: number }
        | { ok: false; error: string };
    }
  | ClientTripActionFailure;

export async function clientAcceptOffer(input: {
  offer_id: string;
  source: 'phase4' | 'phase5';
  cashback_redemption_sar?: number;
}): Promise<ClientAcceptOfferResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

  const parsed = acceptOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const admin = createAdminClient();

  // Step 1: resolve trip_request_id from the chosen offer.
  // Source determines which offer table to read from. We do
  // NOT use a JOIN here — two cheap sequential reads keep the
  // failure modes distinct (offer_not_found vs trip_not_owned)
  // and the RPC below repeats the offer lookup under FOR UPDATE
  // anyway, so a stale read here is harmless.
  const offerTable =
    parsed.data.source === 'phase4'
      ? 'phase4_operator_offers'
      : 'phase5_operator_offers';

  const { data: offerRow, error: offerErr } = await admin
    .from(offerTable)
    .select('trip_request_id')
    .eq('id', parsed.data.offer_id)
    .maybeSingle();

  if (offerErr) {
    console.error(
      '[clients-trip-requests.clientAcceptOffer] offer lookup error',
      offerErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (!offerRow) {
    // Offer id does not exist in the chosen source table. The
    // accept_offer RPC would surface this as `offer_not_pending`,
    // but we short-circuit with the same opaque shape so the UI
    // doesn't differentiate (Phase 8 leg_not_found discipline).
    return { ok: false, error: 'accept_failed' };
  }

  // Step 2: assert trip ownership against session.client_id.
  const { data: tripRow, error: tripErr } = await admin
    .from('trip_requests')
    .select('client_id')
    .eq('id', (offerRow as { trip_request_id: string }).trip_request_id)
    .maybeSingle();

  if (tripErr) {
    console.error(
      '[clients-trip-requests.clientAcceptOffer] trip lookup error',
      tripErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (
    !tripRow ||
    (tripRow as { client_id: string | null }).client_id !==
      session.client_id
  ) {
    return { ok: false, error: 'accept_failed' };
  }

  // Step 3: call the existing Phase 5/6 accept_offer RPC. We
  // re-use the loose-client cast to keep PR 9 code consistent
  // (no Functions map dependency for new code paths).
  const loose = looseClient();
  const { data, error } = await loose.rpc('accept_offer', {
    p_source: parsed.data.source,
    p_offer_id: parsed.data.offer_id,
  });

  if (error) {
    console.error(
      '[clients-trip-requests.clientAcceptOffer] rpc error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; trip_request_id: string; booking_id?: string | null }
    | { ok: false; error: string };

  if (!result.ok) {
    // Pass through accept_offer's structured contracts:
    // unknown_source / offer_not_pending / trip_not_open /
    // offer_expired. The i18n map renders friendly Arabic.
    return { ok: false, error: result.error };
  }

  revalidatePath('/me/requests');
  revalidatePath(`/me/requests/${result.trip_request_id}`);
  revalidatePath('/me/bookings');

  // Phase 13 PR 3 — optional cashback redemption against the
  // freshly created booking. The accept itself ALREADY succeeded;
  // a redemption failure does NOT roll back the booking. UI uses
  // the returned envelope to show a soft warning if the redeem
  // failed (e.g. race-condition insufficient_balance).
  //
  // The legacy phase4 accept path doesn't return booking_id;
  // skip redeem when no booking_id surfaced. UI prevents the
  // redemption widget from rendering for those flows.
  const redeem =
    result.booking_id && parsed.data.cashback_redemption_sar
      ? await redeemCashbackIfRequested({
          client_id: session.client_id,
          booking_id: result.booking_id,
          cashback_redemption_sar: parsed.data.cashback_redemption_sar,
        })
      : null;

  return {
    ok: true,
    trip_request_id: result.trip_request_id,
    booking_id: result.booking_id ?? null,
    ...(redeem
      ? {
          cashback_redemption: redeem.ok
            ? {
                ok: true as const,
                redeemed_sar: redeem.redeemed_sar,
                new_balance_sar: redeem.new_balance_sar,
              }
            : { ok: false as const, error: redeem.error },
        }
      : {}),
  };
}

// ============================================================
// 4. clientDeclineOffer (Phase 9 PR 3)
// ============================================================
//
// Single conditional UPDATE that asserts THREE independent
// guards inside the SQL WHERE clause (Phase 9 spec §5 PR 3 —
// Codex round 4 P1 #2 fix on spec):
//   1. Trip ownership: `trip_request_id` joins to a
//      trip_requests row whose `client_id = session.client_id`.
//   2. Offer status: the offer row's `status = 'pending'`.
//      Already-accepted/expired/rejected offers MUST NOT be
//      mutated (idempotency + race guard).
//   3. Trip status: the parent trip's `status IN
//      ('distributed', 'offered')`. A booked trip's offers are
//      frozen; declining one would corrupt the booking-
//      acceptance audit chain.
//
// Source discriminator picks the right table
// (phase4_operator_offers vs phase5_operator_offers). Single-
// result opaque model: zero rows → `decline_not_allowed`,
// regardless of which guard tripped (Phase 8 leg_not_found
// discipline).
//
// Implementation note: PostgREST does NOT let `.update().eq()`
// chains assert a JOINed condition (the trip ownership +
// trip-status guards). We satisfy guards 1 + 3 with a small
// pre-SELECT under the same client (single read), then run the
// UPDATE with the offer-status guard (#2) inline. Guards 1 + 3
// are strictly read-only checks against trip_requests; the
// UPDATE itself only writes to the offer table. If anything
// races between the read and the UPDATE (the trip flips to
// 'booked'/'cancelled' mid-flight), the offer row's own
// `status='pending'` predicate still gates correctly because
// accept_offer flips siblings to 'rejected' atomically as part
// of its booking transaction.

export type ClientDeclineOfferResult =
  | { ok: true; offer_id: string }
  | ClientTripActionFailure;

export async function clientDeclineOffer(input: {
  offer_id: string;
  source: 'phase4' | 'phase5';
}): Promise<ClientDeclineOfferResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

  const parsed = declineOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const admin = createAdminClient();
  const offerTable =
    parsed.data.source === 'phase4'
      ? 'phase4_operator_offers'
      : 'phase5_operator_offers';

  // Pre-SELECT: trip ownership + trip status (guards #1 + #3).
  // One join via offer→trip; if either guard fails we return
  // opaque decline_not_allowed without touching the offer row.
  const { data: ownerRow, error: ownerErr } = await admin
    .from(offerTable)
    .select(
      'id, trip_request_id, trip_requests!inner(client_id, status)'
    )
    .eq('id', parsed.data.offer_id)
    .maybeSingle();

  if (ownerErr) {
    console.error(
      '[clients-trip-requests.clientDeclineOffer] owner lookup error',
      ownerErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  type OwnerRow = {
    id: string;
    trip_request_id: string;
    trip_requests: { client_id: string | null; status: string };
  };
  const owner = ownerRow as OwnerRow | null;

  if (
    !owner ||
    owner.trip_requests.client_id !== session.client_id ||
    !['distributed', 'offered'].includes(owner.trip_requests.status)
  ) {
    return { ok: false, error: 'decline_not_allowed' };
  }

  // UPDATE: writes only to the offer table. The offer-status
  // guard (#2) is the WHERE predicate; PostgREST returns the
  // affected row via .select() so we can detect zero-row
  // races (e.g. accept_offer flipped this row to 'rejected'
  // between our read and our write).
  const { data: updated, error: updateErr } = await admin
    .from(offerTable)
    .update({
      status: 'rejected',
      decided_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.offer_id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (updateErr) {
    console.error(
      '[clients-trip-requests.clientDeclineOffer] update error',
      updateErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (!updated) {
    return { ok: false, error: 'decline_not_allowed' };
  }

  revalidatePath('/me/requests');
  revalidatePath(`/me/requests/${owner.trip_request_id}`);

  return { ok: true, offer_id: parsed.data.offer_id };
}
