'use server';

import { randomBytes, randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdminSession } from '@/lib/admin/auth';
import {
  issueOperatorToken,
  issueOperatorTokenV2,
  OperatorTokenEnvError,
} from '@/lib/operator/token';
import { promoteLeadSchema } from '@/lib/validators/promote-lead';
import {
  mergeTripPreferences,
  tripPreferencesSchema,
} from '@/lib/validators/trip-preferences';
import { dispatchTripSchema } from '@/lib/validators/dispatch';
import { dispatchTripV2Schema } from '@/lib/validators/dispatch-v2';
import { getLeadById } from '@/lib/supabase/queries/leads';
import {
  acceptOperatorOffer,
  DispatchStateError,
  persistDispatchState,
  promoteLeadToTripRequest,
} from '@/lib/supabase/queries/trips';
import {
  acceptOfferRpc,
  openPhase5DispatchRoundRpc,
} from '@/lib/supabase/queries/phase5-offers';
import {
  buildOperatorUrl,
  buildOperatorWhatsAppLink,
} from '@/lib/operator/links';
import type {
  OfferSource,
  Phase5DispatchTargetInput,
  TripLeg,
} from '@/types/database';

export type PromoteResult =
  | { ok: true; trip_request_id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'lead_not_found'
        | 'lead_not_promotable'
        | 'failed';
    };

export async function promoteLead(formData: FormData): Promise<PromoteResult> {
  requireAdminSession();

  // Phase 6.1 PR 2: read the preferences JSON blob the
  // admin form serializes from its preference fields.
  // Empty string (no preferences entered) becomes `{}`.
  const preferencesRaw = formData.get('preferences');
  let preferencesParsed: ReturnType<typeof tripPreferencesSchema.safeParse>;
  try {
    const candidate =
      typeof preferencesRaw === 'string' && preferencesRaw.trim().length > 0
        ? JSON.parse(preferencesRaw)
        : {};
    preferencesParsed = tripPreferencesSchema.safeParse(candidate);
  } catch {
    return { ok: false, error: 'invalid_input' };
  }
  if (!preferencesParsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  const parsed = promoteLeadSchema.safeParse({
    lead_id: formData.get('lead_id'),
    aircraft_category: formData.get('aircraft_category'),
    special_requests: formData.get('special_requests'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  const lead = await getLeadById(parsed.data.lead_id);
  if (!lead) {
    return { ok: false, error: 'lead_not_found' };
  }

  const legs = buildLegsFromLead(lead);

  // Phase 6.1 PR 2: merge admin-edited preferences over the
  // lead's pre-existing preferences (read from
  // lead_inquiries.preferences). The merge helper strips
  // null/undefined/empty values from the admin overlay so
  // the canonical "key omission = no preference" rule
  // holds. The legacy lead_trip_type key is injected by
  // the RPC body itself (last-write-wins on JSONB || in
  // SQL); we don't need to inject it here.
  const mergedPreferences = mergeTripPreferences(
    lead.preferences,
    preferencesParsed.data
  );

  let result;
  try {
    result = await promoteLeadToTripRequest({
      p_lead_id: parsed.data.lead_id,
      p_legs: legs,
      p_aircraft_category: parsed.data.aircraft_category,
      p_special_requests: parsed.data.special_requests ?? null,
      p_lead_trip_type: lead.trip_type,
      p_preferences: mergedPreferences,
    });
  } catch (err) {
    console.error('[trips-action] promoteLead RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath('/admin/leads');
  revalidatePath(`/admin/leads/${parsed.data.lead_id}`);
  revalidatePath('/admin/trips');
  redirect(`/admin/trips/${result.trip_request_id}`);
}

// Phase 6.0 PR 2 (S4) — IATA-aware leg construction.
//
// Surgical change inside actions/trips.ts: this function (and
// only this function) gets the new shape. The dispatch-engine
// surfaces in this same file (`dispatchTrip`, `acceptOffer`,
// the Phase 5 helpers) are NOT touched, honoring the spec's
// "no admin dispatch engine change" Out-of-scope clause —
// `buildLegsFromLead` is lead-promotion (Phase 4-era), not
// dispatch.
//
// The lead carries `origin` (display label, NOT NULL) AND
// `origin_iata` (nullable, populated when the customer picked
// from the AirportCombobox). The mapping into `TripLeg`:
//   - lead.origin_iata set  → leg.from = IATA, leg.from_freeform = null
//   - lead.origin_iata null → leg.from = null, leg.from_freeform = lead.origin
// Same for destination. The promote_lead_to_trip_request RPC
// (PR 1) reads `legs[0].from` against the airports table and
// populates `trip_requests.departure_airport` accordingly —
// freeform legs land with that column NULL.
function buildLegsFromLead(lead: {
  origin: string;
  destination: string;
  origin_iata: string | null;
  destination_iata: string | null;
  departure_date: string;
  return_date: string | null;
  trip_type: 'one_way' | 'round_trip' | 'multi_city';
}): TripLeg[] {
  const fromIata = lead.origin_iata;
  const toIata = lead.destination_iata;

  const outbound: TripLeg = {
    from: fromIata,
    to: toIata,
    date: lead.departure_date,
    time: null,
    from_freeform: fromIata ? null : lead.origin,
    to_freeform: toIata ? null : lead.destination,
  };

  if (lead.trip_type === 'round_trip' && lead.return_date) {
    return [
      outbound,
      {
        from: toIata,
        to: fromIata,
        date: lead.return_date,
        time: null,
        from_freeform: toIata ? null : lead.destination,
        to_freeform: fromIata ? null : lead.origin,
      },
    ];
  }
  // multi_city in Phase 4 stores a single primary leg; admin must
  // edit before dispatch (see CLAUDE-TASK.md §2 multi-city note).
  return [outbound];
}

export interface DispatchResultOk {
  ok: true;
  operator_url: string;
  whatsapp_link: string;
  expires_at: string;
}

export type DispatchResult =
  | DispatchResultOk
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'env_missing'
        | 'trip_closed'
        | 'trip_not_found'
        | 'failed';
    };

export async function dispatchTrip(formData: FormData): Promise<DispatchResult> {
  requireAdminSession();

  const parsed = dispatchTripSchema.safeParse({
    trip_request_id: formData.get('trip_request_id'),
    operator_phone: formData.get('operator_phone'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  let issued;
  try {
    issued = issueOperatorToken({
      tripRequestId: parsed.data.trip_request_id,
    });
  } catch (err) {
    console.error('[trips-action] issueOperatorToken failed', err);
    return { ok: false, error: 'env_missing' };
  }

  const expiresAtIso = new Date(issued.payload.expires_at * 1000).toISOString();

  try {
    await persistDispatchState({
      tripRequestId: parsed.data.trip_request_id,
      nonce: issued.payload.nonce,
      expiresAt: expiresAtIso,
      targetPhone: parsed.data.operator_phone,
    });
  } catch (err) {
    // The token issued above was never persisted, so it cannot
    // validate against the DB nonce — no leak.
    if (err instanceof DispatchStateError) {
      return { ok: false, error: err.code };
    }
    console.error('[trips-action] persistDispatchState failed', err);
    return { ok: false, error: 'failed' };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://aeris.sa';
  const operatorUrl = `${siteUrl}/operator/offer/${issued.token}`;
  const whatsappLink = buildOperatorWhatsAppLink(
    parsed.data.operator_phone,
    operatorUrl
  );

  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}`);
  revalidatePath('/admin/trips');
  return {
    ok: true,
    operator_url: operatorUrl,
    whatsapp_link: whatsappLink,
    expires_at: expiresAtIso,
  };
}

export type AcceptResult =
  | { ok: true; trip_request_id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'offer_expired'
        | 'offer_not_pending'
        | 'trip_not_open'
        | 'failed';
    };

export async function acceptOffer(formData: FormData): Promise<AcceptResult> {
  requireAdminSession();

  const offerId = formData.get('offer_id');
  if (typeof offerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(offerId)) {
    return { ok: false, error: 'invalid_input' };
  }

  let result;
  try {
    result = await acceptOperatorOffer({ p_offer_id: offerId });
  } catch (err) {
    console.error('[trips-action] acceptOffer RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!result.ok) {
    revalidatePath('/admin/trips');
    return { ok: false, error: result.error };
  }

  revalidatePath('/admin/trips');
  revalidatePath(`/admin/trips/${result.trip_request_id}`);
  return { ok: true, trip_request_id: result.trip_request_id };
}

// ============================================================================
// Phase 5 — multi-operator dispatch
// ============================================================================
//
// These actions are added to the file but NOT wired into any UI in this PR.
// PR 4 (multi-row dispatch UI + comparison view) wires them. They're
// importable from app code today; importing them is a no-op until the
// caller exists.
//
// Phase 4 actions above (promoteLead / dispatchTrip / acceptOffer) keep
// working unchanged. The unified accept_offer RPC supersedes them in the
// Phase 5 admin UI but the Phase 4 acceptOffer Server Action stays
// available for any caller that hasn't migrated yet.

const TOKEN_TTL_SECONDS = 72 * 60 * 60;

export interface DispatchTripV2DispatchEntry {
  target_id: string;
  target_phone: string;
  operator_url: string;
  whatsapp_link: string;
  sent_at: string;
  expires_at: string;
}

export interface DispatchTripV2ResultOk {
  ok: true;
  round_id: string;
  dispatches: DispatchTripV2DispatchEntry[];
}

export type DispatchTripV2Result =
  | DispatchTripV2ResultOk
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'env_missing'
        | 'trip_not_found'
        | 'trip_not_open'
        | 'invalid_targets'
        | 'failed';
    };

/**
 * Phase 5 multi-operator dispatch Server Action.
 *
 * Implements the spec's pre-build-then-commit atomicity contract:
 * captures `batch_now` once, locally generates target_id, nonce,
 * sent_at (= batch_now), expires_at (= batch_now + 72h), the v=2
 * HMAC token, the operator URL, and the WhatsApp link for every
 * phone, BEFORE any DB write. If any local step throws, the RPC
 * is never called and the trip is unchanged.
 *
 * The RPC then inserts the supplied target rows AS-IS, so the
 * persisted sent_at matches the issued_at baked into the token
 * byte-for-byte (iteration-3 P1 fix). The trip detail page can
 * later rebuild the operator URLs from the persisted rows via
 * `issueOperatorTokenFromTarget` and produce identical URLs.
 *
 * `phones` accepts 1..8 E.164 numbers, unique within the array.
 * The DB RPC re-checks both as defense-in-depth.
 */
export async function dispatchTripV2(formData: FormData): Promise<DispatchTripV2Result> {
  requireAdminSession();

  // 1. Parse + validate inputs.
  const phonesRaw = formData.getAll('phones').filter((v): v is string => typeof v === 'string');
  const parsed = dispatchTripV2Schema.safeParse({
    trip_request_id: formData.get('trip_request_id'),
    phones: phonesRaw,
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const { trip_request_id, phones } = parsed.data;

  // 2. Capture batch_now ONCE for the whole batch. sent_at and the
  //    token's issued_at both derive from this single instant so
  //    the rebuild path produces byte-identical tokens.
  const batchNow = new Date();
  const expiresAt = new Date(batchNow.getTime() + TOKEN_TTL_SECONDS * 1000);
  const sentAtIso = batchNow.toISOString();
  const expiresAtIso = expiresAt.toISOString();

  // 3. Pre-build the entire batch in memory. Any throw here aborts
  //    BEFORE any DB call, leaving the trip unchanged.
  let dispatches: DispatchTripV2DispatchEntry[];
  let rpcTargets: Phase5DispatchTargetInput[];
  try {
    const built = phones.map((phone) => {
      const target_id = randomUUID();
      const nonce = randomBytes(16).toString('hex');
      const issued = issueOperatorTokenV2({
        tripRequestId: trip_request_id,
        targetId: target_id,
        nonce,
        sentAt: batchNow,
        expiresAt,
      });
      const operatorUrl = buildOperatorUrl(issued.token);
      const whatsappLink = buildOperatorWhatsAppLink(phone, operatorUrl);
      return {
        rpcTarget: {
          id: target_id,
          target_phone: phone,
          nonce,
          sent_at: sentAtIso,
          expires_at: expiresAtIso,
        } satisfies Phase5DispatchTargetInput,
        dispatchEntry: {
          target_id,
          target_phone: phone,
          operator_url: operatorUrl,
          whatsapp_link: whatsappLink,
          sent_at: sentAtIso,
          expires_at: expiresAtIso,
        } satisfies DispatchTripV2DispatchEntry,
      };
    });
    rpcTargets = built.map((b) => b.rpcTarget);
    dispatches = built.map((b) => b.dispatchEntry);
  } catch (err) {
    if (err instanceof OperatorTokenEnvError) {
      return { ok: false, error: 'env_missing' };
    }
    console.error('[trips-action] dispatchTripV2 pre-build failed', err);
    return { ok: false, error: 'failed' };
  }

  // 4. Single RPC call. Either the round + N targets all commit
  //    or nothing changes. The pre-built tokens are discarded on
  //    failure (never reach the operator).
  let rpcResult;
  try {
    rpcResult = await openPhase5DispatchRoundRpc({
      p_trip_id: trip_request_id,
      p_targets: rpcTargets,
    });
  } catch (err) {
    console.error('[trips-action] open_phase5_dispatch_round RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!rpcResult.ok) {
    return { ok: false, error: rpcResult.error };
  }

  revalidatePath(`/admin/trips/${trip_request_id}`);
  revalidatePath('/admin/trips');
  return {
    ok: true,
    round_id: rpcResult.round_id,
    dispatches,
  };
}


export type AcceptOfferV2Result =
  | { ok: true; trip_request_id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'unknown_source'
        | 'offer_expired'
        | 'offer_not_pending'
        | 'trip_not_open'
        | 'failed';
    };

/**
 * Phase 5 unified accept Server Action.
 *
 * Wraps the SQL `accept_offer(p_source, p_offer_id)` RPC, which
 * routes to the correct offer table by source ('phase4' | 'phase5')
 * and atomically rejects every sibling on the trip across BOTH
 * tables, cancels every pending Phase 5 target, closes every open
 * round, and books the trip.
 *
 * Both `offer_id` and `offer_source` come from the row in the
 * (future) unified comparison view — see
 * `lib/supabase/queries/unified-offers.ts`. Until the UI is
 * wired (PR 4), this Server Action is reachable from app code but
 * has no UI caller.
 */
export async function acceptOfferV2(formData: FormData): Promise<AcceptOfferV2Result> {
  requireAdminSession();

  const offerId = formData.get('offer_id');
  const offerSource = formData.get('offer_source');

  if (typeof offerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(offerId)) {
    return { ok: false, error: 'invalid_input' };
  }
  if (offerSource !== 'phase4' && offerSource !== 'phase5') {
    return { ok: false, error: 'invalid_input' };
  }

  let result;
  try {
    result = await acceptOfferRpc({
      p_source: offerSource as OfferSource,
      p_offer_id: offerId,
    });
  } catch (err) {
    console.error('[trips-action] acceptOfferV2 RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!result.ok) {
    revalidatePath('/admin/trips');
    return { ok: false, error: result.error };
  }

  revalidatePath('/admin/trips');
  revalidatePath(`/admin/trips/${result.trip_request_id}`);
  return { ok: true, trip_request_id: result.trip_request_id };
}
