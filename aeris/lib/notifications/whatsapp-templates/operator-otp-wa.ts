/**
 * Phase 8.1 Codex round 1 PR #46 P1 fix — Arabic WhatsApp body
 * for the operator OTP code (login + recovery).
 *
 * The OTP is a 6-digit numeric code with a 10-minute TTL,
 * minted by adminMintOperatorOtp -> mint_operator_otp RPC
 * (the DB stores the SHA-256 hash; the plaintext travels only
 * over the notification channel + the admin response).
 *
 * Body discipline:
 *   - The 6-digit code is on its own line so it is one-tap
 *     copyable from WhatsApp on mobile.
 *   - Western digits (project convention).
 *   - Purpose label is localised (login | recovery) so the
 *     operator knows which flow asked for this code.
 *   - Phishing guard: "do not share this code" notice.
 *   - Expiry stated in minutes (10) instead of an absolute
 *     timestamp because the TTL is short and operators react
 *     to "10 minutes" faster than a wall-clock value that
 *     they have to mentally compare to "now".
 */

export type OperatorOtpPurpose = 'login' | 'recovery';

export interface BuildOperatorOtpWhatsAppBodyInput {
  company_name: string;
  code: string;
  purpose: OperatorOtpPurpose;
  expires_in_minutes: number;
}

export function buildOperatorOtpWhatsAppBody(
  input: BuildOperatorOtpWhatsAppBodyInput
): string {
  const { company_name, code, purpose, expires_in_minutes } = input;
  const purposeLabel =
    purpose === 'login' ? 'تسجيل الدخول' : 'استرداد الحساب';
  return [
    'مرحباً ' + company_name + '،',
    '',
    'رمز التحقّق لـ' + purposeLabel + ' في Aeris:',
    '',
    code,
    '',
    'صالح لمدّة ' + String(expires_in_minutes) + ' دقائق.',
    'لا تشاركوا هذا الرمز مع أي شخص — موظّفو Aeris لن يطلبوه منكم.',
    '',
    'فريق Aeris',
  ].join('\n');
}
