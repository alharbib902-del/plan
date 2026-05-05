import 'server-only';

import { AERIS_CONTACT } from '@/lib/config/contact';
import { normalizeWhatsAppPhone } from '@/lib/utils/format';

/**
 * Build the public operator URL for a signed token.
 *
 * Reads `NEXT_PUBLIC_SITE_URL` (set in Vercel env) and falls back
 * to `https://aeris.sa` if missing. Both Phase 4 and Phase 5
 * dispatch paths use this — same URL shape, different token
 * payload version.
 */
export function buildOperatorUrl(token: string): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://aeris.sa';
  return `${siteUrl}/operator/offer/${token}`;
}

/**
 * Build a WhatsApp deep-link with a pre-filled invite message
 * containing the operator URL. Admin clicks "open WhatsApp" to
 * dispatch each operator manually (no WhatsApp Business API).
 *
 * The phone is normalized to digit-only form per
 * `normalizeWhatsAppPhone` so wa.me works for Saudi local
 * formats (05XXXXXXXX, 5XXXXXXXX) as well as E.164.
 */
export function buildOperatorWhatsAppLink(
  operatorPhoneE164: string,
  operatorUrl: string
): string {
  const digits = normalizeWhatsAppPhone(operatorPhoneE164);
  const message = [
    'مرحباً،',
    'هذه دعوة لتقديم عرض على رحلة خاصة عبر منصة Aeris.',
    '',
    `الرابط: ${operatorUrl}`,
    '',
    `للاستفسار: wa.me/${AERIS_CONTACT.whatsappNumber}`,
  ].join('\n');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
