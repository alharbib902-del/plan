/**
 * P0 (2026-07) — Arabic WhatsApp body for the GUEST empty-leg
 * reservation confirmation.
 *
 * Fires from reserveEmptyLeg (public marketplace) right after
 * the reservation RPC succeeds, in parallel to the founder
 * email alert. The authenticated client path intentionally
 * stays email-only (clients already receive the reservation
 * confirmation email via client-empty-leg-email.ts).
 *
 * Transactional-only discipline:
 *   - Confirms the reservation request was received + states
 *     the hold window.
 *   - Carries the tokenized /reserved manage URL (view/cancel)
 *     on its own line so WhatsApp auto-link detection renders
 *     it as a tappable link.
 *   - NO price (request-to-book: prices go out only after the
 *     founder's seriousness check) and NO marketing content —
 *     transactional messages keep the wasender sender number
 *     in good standing.
 *   - Western digits (project convention: 1/2/3 not ١/٢/٣).
 *
 * Length budget: lands at ~350 characters, well under the
 * ~1000-character WhatsApp soft limit.
 */

export interface BuildEmptyLegReservationWhatsAppBodyInput {
  customer_name: string;
  leg_number: string;
  route_from: string;
  route_to: string;
  /** Absolute tokenized /reserved URL (view + cancel). */
  manage_url: string;
  /** Hold window in minutes — kept as a parameter so the copy
   *  tracks the reservation token TTL (currently 60). */
  hold_minutes: number;
}

export function buildEmptyLegReservationWhatsAppBody(
  input: BuildEmptyLegReservationWhatsAppBodyInput
): string {
  const {
    customer_name,
    leg_number,
    route_from,
    route_to,
    manage_url,
    hold_minutes,
  } = input;
  return [
    'مرحباً ' + customer_name + '،',
    '',
    'تم استلام طلب حجزك للرحلة ' +
      leg_number +
      ' (' +
      route_from +
      ' ← ' +
      route_to +
      ').',
    'المقعد محفوظ لك مؤقتاً لمدة ' + String(hold_minutes) + ' دقيقة.',
    'لمتابعة الحجز أو إلغائه، افتح الرابط:',
    '',
    manage_url,
    '',
    'سيتواصل معك فريق Aeris لتأكيد التفاصيل.',
    '',
    'فريق Aeris',
  ].join('\n');
}
