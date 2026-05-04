'use server';

import { revalidatePath } from 'next/cache';

import { verifyOperatorToken } from '@/lib/operator/token';
import { operatorOfferSchema } from '@/lib/validators/operator-offer';
import { submitOperatorOfferRpc } from '@/lib/supabase/queries/phase4-offers';

export type SubmitOperatorOfferResult =
  | { ok: true; offer_id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'token_invalid'
        | 'trip_not_found'
        | 'trip_closed'
        | 'token_stale'
        | 'failed';
    };

export async function submitOperatorOffer(
  formData: FormData
): Promise<SubmitOperatorOfferResult> {
  // 1. Validate the token. Necessary but not sufficient — the RPC
  //    re-checks dispatch_nonce + dispatch_expires_at under
  //    FOR UPDATE to close the re-dispatch race.
  const tokenValue = formData.get('token');
  if (typeof tokenValue !== 'string') {
    return { ok: false, error: 'token_invalid' };
  }
  const verified = verifyOperatorToken(tokenValue);
  if (!verified.valid) {
    return { ok: false, error: 'token_invalid' };
  }

  // 2. Validate the form payload.
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

  // 3. Convert the local datetime string from <input type="datetime-local">
  //    to an ISO string. The form value is a naive local-time string
  //    "YYYY-MM-DDTHH:mm"; new Date() interprets it in the server's
  //    timezone, which is what we want for the operator's own slot.
  let departureEtaIso: string;
  try {
    departureEtaIso = new Date(parsed.data.departure_eta).toISOString();
  } catch {
    return { ok: false, error: 'invalid_input' };
  }

  // 4. Invoke the RPC. The RPC re-locks trip_requests, re-verifies
  //    dispatch_nonce + dispatch_expires_at, inserts the offer, and
  //    promotes trip status — all in one transaction.
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
    console.error('[operator-offer-action] RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/trips/${verified.payload.trip_request_id}`);
  revalidatePath('/admin/trips');
  return { ok: true, offer_id: result.offer_id };
}
