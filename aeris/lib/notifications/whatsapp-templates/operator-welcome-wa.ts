/**
 * Phase 8.1 — Arabic WhatsApp body for the operator welcome
 * notification (parallel to the Resend welcome email).
 *
 * WhatsApp messages are plain text with no HTML/markdown, so
 * the template focuses on:
 *   - Brand identifier ("Aeris" / "أيريس")
 *   - Recipient acknowledgement (company name)
 *   - The magic-link URL on its own line so WhatsApp clients
 *     auto-detect and render it as a tappable link
 *   - Expiry notice in Arabic numerals (Western digits per
 *     project convention)
 *
 * Length budget: WhatsApp soft limit is ~1000 characters; this
 * body lands at ~250 to stay readable on small screens.
 */

export interface BuildOperatorWelcomeWhatsAppBodyInput {
  company_name: string;
  welcome_url: string;
  expires_at: Date;
}

export function buildOperatorWelcomeWhatsAppBody(
  input: BuildOperatorWelcomeWhatsAppBodyInput
): string {
  const { company_name, welcome_url, expires_at } = input;
  const expiresLabel = formatExpiryArabic(expires_at);
  return [
    'مرحباً ' + company_name + '،',
    '',
    'تم اعتماد حسابكم في منصّة Aeris.',
    'لاستكمال التفعيل وتعيين كلمة المرور، افتحوا الرابط التالي:',
    '',
    welcome_url,
    '',
    'الرابط صالح حتى: ' + expiresLabel,
    '',
    'فريق Aeris',
  ].join('\n');
}

/**
 * Phase 8.1 — Arabic WhatsApp body for the password reset link.
 *
 * Mirrors the welcome template but with reset-specific copy.
 * Uses the same magic-link-on-its-own-line layout so WhatsApp's
 * link detector renders it cleanly.
 */
export interface BuildOperatorPasswordResetWhatsAppBodyInput {
  company_name: string;
  reset_url: string;
  expires_at: Date;
}

export function buildOperatorPasswordResetWhatsAppBody(
  input: BuildOperatorPasswordResetWhatsAppBodyInput
): string {
  const { company_name, reset_url, expires_at } = input;
  const expiresLabel = formatExpiryArabic(expires_at);
  return [
    'مرحباً ' + company_name + '،',
    '',
    'وصلنا طلب لإعادة تعيين كلمة مرور حساب المشغّل في Aeris.',
    'لتعيين كلمة مرور جديدة، افتحوا الرابط التالي:',
    '',
    reset_url,
    '',
    'الرابط صالح حتى: ' + expiresLabel,
    'إن لم تطلبوا ذلك، تجاهلوا هذه الرسالة.',
    '',
    'فريق Aeris',
  ].join('\n');
}

/**
 * Format an expiry date in Asia/Riyadh local time using Western
 * digits (project convention: numbers are 1/2/3 not ١/٢/٣ for
 * cross-locale parseability and to match the rest of the UI).
 *
 * Example: "السبت 18 مايو 2026 — 09:30"
 */
function formatExpiryArabic(date: Date): string {
  try {
    const formatted = new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
      timeZone: 'Asia/Riyadh',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return formatted;
  } catch {
    // Defensive: Intl can throw if the runtime ICU build is
    // missing the ar-SA locale. Fall back to ISO so the
    // message body never breaks.
    return date.toISOString();
  }
}
