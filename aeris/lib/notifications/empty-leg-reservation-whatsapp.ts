import 'server-only';

import {
  normaliseSaudiPhoneE164,
  sendWhatsAppMessage,
  type WhatsAppDeliveryResult,
} from './whatsapp-provider';
import { buildEmptyLegReservationWhatsAppBody } from './whatsapp-templates/empty-leg-reservation-wa';

/**
 * P0 (2026-07) — guest-facing WhatsApp confirmation for the
 * public empty-legs reservation flow. Mirror of
 * operator-whatsapp.ts: maps the reservation payload to a
 * provider-agnostic delivery result and never throws — the
 * calling Server Action logs the outcome and always completes
 * the reservation regardless.
 *
 * Guest phones are loosely validated at the form layer
 * (min 8 / max 32 chars, no shape enforcement), so the number
 * is pre-flight checked through the provider's normaliser and
 * only sent when it comes out E.164-shaped; anything else is
 * skipped gracefully with reason='invalid_phone'.
 */

/** Keep in lockstep with reservation-token DEFAULT_TTL_SECONDS. */
export const EMPTY_LEG_RESERVATION_HOLD_MINUTES = 60;

export interface SendEmptyLegReservationWhatsAppInput {
  to_phone: string;
  customer_name: string;
  leg_number: string;
  route_from: string;
  route_to: string;
  /** Absolute tokenized /reserved manage URL (view + cancel). */
  manage_url: string;
}

export async function sendEmptyLegReservationWhatsApp(
  input: SendEmptyLegReservationWhatsAppInput
): Promise<WhatsAppDeliveryResult> {
  const phone = normaliseSaudiPhoneE164(input.to_phone);
  if (!phone) {
    return {
      ok: false,
      reason: 'invalid_phone',
      detail: 'guest phone did not normalise to a plausible E.164 shape',
    };
  }
  const text = buildEmptyLegReservationWhatsAppBody({
    customer_name: input.customer_name,
    leg_number: input.leg_number,
    route_from: input.route_from,
    route_to: input.route_to,
    manage_url: input.manage_url,
    hold_minutes: EMPTY_LEG_RESERVATION_HOLD_MINUTES,
  });
  return sendWhatsAppMessage({ to: phone, text });
}
