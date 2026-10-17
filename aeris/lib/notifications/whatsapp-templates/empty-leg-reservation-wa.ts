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

const GREETING_NAME_MAX_CHARS = 40;

/**
 * The guest name is free text from an anonymous form, and the message
 * goes from Aeris's official number to a phone the guest typed — so a
 * raw echo would let anyone send "Aeris-branded" text (links, phone
 * numbers, instructions) to an arbitrary victim. URL/domain/email-like
 * tokens are dropped whole, then only letters, combining marks (Arabic
 * diacritics), spaces and name punctuation survive: no digits, dots,
 * slashes, '@' or newlines means no link or phone number can get
 * through. Returns '' when nothing usable is left.
 */
export function sanitiseGreetingName(raw: string): string {
  const lettersOnly = raw
    .normalize('NFKC')
    .replace(/\S*[.:/\\@]\S*/g, ' ')
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const capped = Array.from(lettersOnly)
    .slice(0, GREETING_NAME_MAX_CHARS)
    .join('')
    .trim();
  return /\p{L}/u.test(capped) ? capped : '';
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
  const name = sanitiseGreetingName(customer_name);
  return [
    name ? 'مرحباً ' + name + '،' : 'مرحباً،',
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
