import 'server-only';

import {
  sendWhatsAppMessage,
  type WhatsAppDeliveryResult,
} from './whatsapp-provider';
import {
  buildOperatorWelcomeWhatsAppBody,
  buildOperatorPasswordResetWhatsAppBody,
} from './whatsapp-templates/operator-welcome-wa';
import {
  buildOperatorOtpWhatsAppBody,
  type OperatorOtpPurpose,
} from './whatsapp-templates/operator-otp-wa';

/**
 * Phase 8.1 — operator-facing WhatsApp wrappers. Mirror of
 * operator-email.ts: each function maps a domain payload (the
 * operator row + a freshly minted magic-link URL) to a
 * provider-agnostic delivery result, never throws, and is
 * fired in parallel to the equivalent email wrapper from the
 * Server Action layer.
 *
 * Three flavours match the email module:
 *   1. sendOperatorWelcomeWhatsApp — fires after admin approves
 *      a pending operator. Body contains the welcome magic link.
 *   2. (Rejection notifications stay email-only by design — a
 *      WhatsApp message after a rejection is high-friction and
 *      out of Phase 8.1 scope.)
 *   3. sendOperatorPasswordResetLinkWhatsApp — fires after admin
 *      generates a reset link for an approved operator.
 *
 * The wrappers pass the recipient phone through the provider's
 * normaliser (E.164 with leading '+'); callers MUST supply a
 * non-empty phone string and let the provider reject malformed
 * input via WhatsAppDeliveryResult.reason='invalid_phone'.
 */

export interface SendOperatorWelcomeWhatsAppInput {
  to_phone: string;
  company_name: string;
  welcome_url: string;
  expires_at: Date;
}

export async function sendOperatorWelcomeWhatsApp(
  input: SendOperatorWelcomeWhatsAppInput
): Promise<WhatsAppDeliveryResult> {
  const text = buildOperatorWelcomeWhatsAppBody({
    company_name: input.company_name,
    welcome_url: input.welcome_url,
    expires_at: input.expires_at,
  });
  return sendWhatsAppMessage({ to: input.to_phone, text });
}

export interface SendOperatorPasswordResetLinkWhatsAppInput {
  to_phone: string;
  company_name: string;
  reset_url: string;
  expires_at: Date;
}

export async function sendOperatorPasswordResetLinkWhatsApp(
  input: SendOperatorPasswordResetLinkWhatsAppInput
): Promise<WhatsAppDeliveryResult> {
  const text = buildOperatorPasswordResetWhatsAppBody({
    company_name: input.company_name,
    reset_url: input.reset_url,
    expires_at: input.expires_at,
  });
  return sendWhatsAppMessage({ to: input.to_phone, text });
}

/**
 * Codex round 1 PR #46 P1 fix — WhatsApp delivery for the
 * 6-digit OTP minted by adminMintOperatorOtp. Replaces the
 * previous "admin copies the code into a wa.me link manually"
 * UX with an automated send. The plaintext code is still
 * returned to admin so they can relay manually as a fallback
 * when delivery fails (delivery result is exposed on the
 * Server Action's response shape).
 */
export interface SendOperatorOtpWhatsAppInput {
  to_phone: string;
  company_name: string;
  code: string;
  purpose: OperatorOtpPurpose;
  expires_in_minutes: number;
}

export async function sendOperatorOtpWhatsApp(
  input: SendOperatorOtpWhatsAppInput
): Promise<WhatsAppDeliveryResult> {
  const text = buildOperatorOtpWhatsAppBody({
    company_name: input.company_name,
    code: input.code,
    purpose: input.purpose,
    expires_in_minutes: input.expires_in_minutes,
  });
  return sendWhatsAppMessage({ to: input.to_phone, text });
}
