'use server';

import { revalidatePath } from 'next/cache';

import { verifyOperatorToken } from '@/lib/operator/token';
import { operatorOfferSchema } from '@/lib/validators/operator-offer';
import { submitOperatorOfferRpc } from '@/lib/supabase/queries/phase4-offers';
import { submitPhase5OperatorOfferRpc } from '@/lib/supabase/queries/phase5-offers';

/**
 * Operator submit result. Error codes are a flat union of:
 *
 *   - common:  invalid_input, token_invalid, failed
 *   - v=1 only (Phase 4 RPC): trip_not_found, trip_closed, token_stale
 *   - v=2 only (Phase 5 RPC): invalid_offer, target_not_pending,
 *                             trip_not_open, token_stale (shared label)
 *
 * `token_stale` appears in both unions because both RPCs use the
 * same name for the same semantic ("the link's nonce no longer
 * matches the persisted state"). The form's translateError handles
 * every code; clients shouldn't need to know which path produced
 * the error.
 */
export type SubmitOperatorOfferResult =
  | { ok: true; offer_id: string }
  | {
      ok: false;
      error:
        // common
        | 'invalid_input'
        | 'token_invalid'
        | 'failed'
        // v=1 (Phase 4 RPC)
        | 'trip_not_found'
        | 'trip_closed'
        | 'token_stale'
        // v=2 (Phase 5 RPC)
        | 'invalid_offer'
        | 'target_not_pending'
        | 'trip_not_open';
    };

export async function submitOperatorOffer(
  formData: FormData
): Promise<SubmitOperatorOfferResult> {
  // 1. Validate the token. Necessary but not sufficient — the
  //    target RPC re-checks state under FOR UPDATE.
  const tokenValue = formData.get('token');
  if (typeof tokenValue !== 'string') {
    return { ok: false, error: 'token_invalid' };
  }
  const verified = verifyOperatorToken(tokenValue);
  if (!verified.valid) {
    return { ok: false, error: 'token_invalid' };
  }

  // 2. Validate the form payload. Same Zod schema for both
  //    versions — the RPC pre-validators in the SQL layer do
  //    additional invariants the client can't see.
  const parsed = operatorOfferSchema.safeParse({
    operator_name: formData.get('operator_name'),
    operator_phone: formData.get('operator_phone'),
    operator_email: formData.get('operator_email'),
    aircraft_category: formData.get('aircraft_category') || undefined,
    aircraft_type: formData.get('aircraft_type'),
    aircraft_registration: formData.get('aircraft_registration'),
    total_price_sar: formData.get('total_price_sar'),
    departure_eta: formData.get('departure_eta'),
    validity_hours: formData.get('validity_hours'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  // 3. Convert the local-time string from <input type="datetime-local">
  //    to an ISO string. Same conversion path for both versions.
  let departureEtaIso: string;
  try {
    departureEtaIso = new Date(parsed.data.departure_eta).toISOString();
  } catch {
    return { ok: false, error: 'invalid_input' };
  }

  // 4. Branch by token version. The verifier is single-pass + no
  //    fallback (spec iteration-2 P2 fix), so we trust
  //    `verified.version` to route correctly.

  if (verified.version === 1) {
    // Phase 4 path — unchanged behavior for v=1 tokens issued
    // before the Phase 5 deploy. Submits to phase4_operator_offers
    // via submit_phase4_operator_offer.
    let result;
    try {
      result = await submitOperatorOfferRpc({
        p_token_trip_id: verified.payload.trip_request_id,
        p_token_nonce: verified.payload.nonce,
        p_operator_name: parsed.data.operator_name,
        p_operator_phone: parsed.data.operator_phone,
        p_operator_email: parsed.data.operator_email ?? null,
        p_aircraft_category: parsed.data.aircraft_category ?? null,
        p_aircraft_type: parsed.data.aircraft_type ?? null,
        p_aircraft_registration: parsed.data.aircraft_registration ?? null,
        p_total_price_sar: parsed.data.total_price_sar,
        p_departure_eta: departureEtaIso,
        p_validity_hours: parsed.data.validity_hours,
        p_notes: parsed.data.notes ?? null,
      });
    } catch (err) {
      console.error('[operator-offer-action] v=1 RPC failed', err);
      return { ok: false, error: 'failed' };
    }

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    revalidatePath(`/admin/trips/${verified.payload.trip_request_id}`);
    revalidatePath('/admin/trips');
    return { ok: true, offer_id: result.offer_id };
  }

  // verified.version === 2 — Phase 5 path. Submits to
  // phase5_operator_offers via submit_phase5_operator_offer,
  // which re-locks the parent trip and the target row, re-checks
  // nonce/expiry/round-currency/status, and inserts the offer
  // atomically.
  let result;
  try {
    result = await submitPhase5OperatorOfferRpc({
      p_target_id: verified.payload.dispatch_target_id,
      p_target_nonce: verified.payload.nonce,
      p_operator_name: parsed.data.operator_name,
      p_operator_phone: parsed.data.operator_phone,
      p_operator_email: parsed.data.operator_email ?? null,
      p_aircraft_category: parsed.data.aircraft_category ?? null,
      p_aircraft_type: parsed.data.aircraft_type ?? null,
      p_aircraft_registration: parsed.data.aircraft_registration ?? null,
      p_total_price_sar: parsed.data.total_price_sar,
      p_departure_eta: departureEtaIso,
      p_validity_hours: parsed.data.validity_hours,
      p_notes: parsed.data.notes ?? null,
    });
  } catch (err) {
    console.error('[operator-offer-action] v=2 RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/trips/${verified.payload.trip_request_id}`);
  revalidatePath('/admin/trips');
  return { ok: true, offer_id: result.offer_id };
}
