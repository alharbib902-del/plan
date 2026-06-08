'use server';

import { revalidatePath } from 'next/cache';
import { createHash, randomBytes, randomInt } from 'crypto';
import bcrypt from 'bcryptjs';

import { requireAdminSession } from '@/lib/admin/auth';
import { ADMIN_WRITE_ROLES } from '@/lib/admin/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  mintWelcomeToken,
  WelcomeTokenEnvError,
} from '@/lib/operators/welcome-token';
import {
  sendOperatorWelcomeEmail,
  sendOperatorRejectionEmail,
  sendOperatorPasswordResetEmail,
} from '@/lib/notifications/operator-email';
import { recordEmailAlertStatus } from '@/lib/notifications/email-alert-status';
import {
  sendOperatorWelcomeWhatsApp,
  sendOperatorOtpWhatsApp,
} from '@/lib/notifications/operator-whatsapp';
import { recordWhatsAppAlertStatus } from '@/lib/notifications/whatsapp-alert-status';
import {
  adminApproveOperatorSchema,
  adminRejectOperatorSchema,
  adminSuspendOperatorSchema,
  adminUnsuspendOperatorSchema,
  adminSetOperatorDocumentsSchema,
  adminResetOperatorPasswordSchema,
  adminMintOperatorOtpSchema,
  adminUploadOperatorDocumentSchema,
  adminConvertPhase7StubSchema,
} from '@/lib/validators/operators';
import { fieldErrorsFromZod } from '@/lib/validators/field-errors';

/**
 * Phase 8 PR 2b — 9 admin Server Actions for the operator
 * portal admin surface. Each action:
 *
 *   1. Requires an admin session (cookie-bound).
 *   2. Validates input via Zod.
 *   3. Calls a Phase 8 PR 2a SECURITY DEFINER RPC (or
 *      Supabase Storage for the document upload).
 *   4. Returns a structured `{ ok, ... }` result; the
 *      Arabic-RTL i18n module maps error codes to user-
 *      facing strings on the client.
 *   5. Revalidates the affected admin paths.
 */

// ============================================================
// Shared types
// ============================================================

export type AdminOperatorActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isAdminFlagDisabled(): boolean {
  return process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'false';
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

function revalidateOperator(operatorId: string): void {
  revalidatePath('/admin/operators');
  revalidatePath(`/admin/operators/${operatorId}`);
  revalidatePath(`/admin/operators/${operatorId}/documents`);
}

// ============================================================
// 1. adminApproveOperator
//
// Mints the welcome HMAC token, calls admin_approve_operator
// (which stores sha256(token) + 7-day expiry on the operator
// row), then sends the welcome email containing the magic-link
// URL. The raw token never touches the DB.
// ============================================================

// Codex round 2 (PR #41) P2 #2 fix: result shape now exposes
// welcome-email delivery status. The welcome_url is always
// returned so admin can relay it manually if delivery failed.
//
// Phase 8.1: parallel WhatsApp send via wasender. Result now
// also exposes whatsapp_delivered + whatsapp_failure_reason so
// admin sees both channels in the response. Failure of one
// channel does not block the other; the welcome_url remains
// the manual fallback when both fail.
export type AdminApproveOperatorResult =
  | {
      ok: true;
      operator_id: string;
      welcome_url: string;
      expires_at: string;
      email_delivered: boolean;
      email_failure_reason?:
        | 'env_missing'
        | 'send_failed'
        | 'operator_lookup_failed';
      whatsapp_delivered: boolean;
      whatsapp_failure_reason?:
        | 'config_missing'
        | 'invalid_phone'
        | 'rate_limited'
        | 'send_failed'
        | 'operator_lookup_failed';
    }
  | AdminOperatorActionFailure;

export async function adminApproveOperator(input: {
  operator_id: string;
}): Promise<AdminApproveOperatorResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminApproveOperatorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // Mint welcome token (raw + sha256 hash + expiry)
  let minted;
  try {
    minted = mintWelcomeToken({ operator_id: parsed.data.operator_id });
  } catch (err) {
    if (err instanceof WelcomeTokenEnvError) {
      console.error('[operators.adminApproveOperator] env missing', err);
      return { ok: false, error: 'env_missing' };
    }
    console.error('[operators.adminApproveOperator] mint failed', err);
    return { ok: false, error: 'token_mint_failed' };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_approve_operator', {
    p_operator_id: parsed.data.operator_id,
    p_welcome_token_hash: minted.token_hash,
    p_welcome_token_expires_at: minted.expires_at.toISOString(),
  });

  if (error) {
    console.error('[operators.adminApproveOperator] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as { ok: boolean; error?: string; operator_id?: string };
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'unknown' };
  }

  // Look up operator + send. Both failure paths MUST surface
  // a degraded state to admin so they can relay the welcome
  // URL manually (Codex round 2 PR #41 P2 #2). The approval
  // RPC has already committed; the operator now NEEDS the
  // magic-link URL to set their first session.
  //
  // Phase 8.1: send WhatsApp in parallel via wasender. The
  // welcome magic link is safe to deliver over WhatsApp (single-
  // use, 7-day expiry, bound to the operator row server-side).
  // Both channels are best-effort and reflected independently
  // in the singleton operator_notification_alert_status row.
  const welcomeUrl = `${siteUrl()}/operator/welcome/${minted.raw_token}`;
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('contact_email, contact_phone, company_name')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();

  let emailDelivered = false;
  let emailFailureReason:
    | 'env_missing'
    | 'send_failed'
    | 'operator_lookup_failed'
    | undefined;
  let whatsappDelivered = false;
  let whatsappFailureReason:
    | 'config_missing'
    | 'invalid_phone'
    | 'rate_limited'
    | 'send_failed'
    | 'operator_lookup_failed'
    | undefined;

  if (opErr || !opRow) {
    console.error('[operators.adminApproveOperator] op fetch error', opErr);
    emailFailureReason = 'operator_lookup_failed';
    whatsappFailureReason = 'operator_lookup_failed';
  } else {
    const [emailResult, whatsappResult] = await Promise.all([
      sendOperatorWelcomeEmail({
        to: opRow.contact_email,
        company_name: opRow.company_name,
        welcome_url: welcomeUrl,
        expires_at: minted.expires_at,
      }),
      sendOperatorWelcomeWhatsApp({
        to_phone: opRow.contact_phone,
        company_name: opRow.company_name,
        welcome_url: welcomeUrl,
        expires_at: minted.expires_at,
      }),
    ]);
    if (emailResult.ok) {
      emailDelivered = true;
    } else {
      emailFailureReason = emailResult.reason;
    }
    if (whatsappResult.ok) {
      whatsappDelivered = true;
    } else {
      whatsappFailureReason = whatsappResult.reason;
    }
    // Reflect both delivery outcomes in the singleton alert row
    // so /admin/operators surfaces a degraded banner per channel.
    await Promise.all([
      recordEmailAlertStatus(client, emailResult, 'adminApproveOperator'),
      recordWhatsAppAlertStatus(
        client,
        whatsappResult,
        'adminApproveOperator'
      ),
    ]);
  }

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    operator_id: parsed.data.operator_id,
    welcome_url: welcomeUrl,
    expires_at: minted.expires_at.toISOString(),
    email_delivered: emailDelivered,
    email_failure_reason: emailDelivered ? undefined : emailFailureReason,
    whatsapp_delivered: whatsappDelivered,
    whatsapp_failure_reason: whatsappDelivered
      ? undefined
      : whatsappFailureReason,
  };
}

// ============================================================
// 2. adminRejectOperator
// ============================================================

export type AdminRejectOperatorResult =
  | { ok: true; operator_id: string }
  | AdminOperatorActionFailure;

export async function adminRejectOperator(input: {
  operator_id: string;
  reason: string;
}): Promise<AdminRejectOperatorResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminRejectOperatorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_reject_operator', {
    p_operator_id: parsed.data.operator_id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error('[operators.adminRejectOperator] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  // Send rejection email (best-effort).
  const { data: opRow } = await client
    .from('operators')
    .select('contact_email, company_name')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();
  if (opRow) {
    await sendOperatorRejectionEmail({
      to: opRow.contact_email,
      company_name: opRow.company_name,
      reason: parsed.data.reason,
    });
  }

  revalidateOperator(parsed.data.operator_id);
  return { ok: true, operator_id: parsed.data.operator_id };
}

// ============================================================
// 3. adminSuspendOperator
// ============================================================

export type AdminSuspendOperatorResult =
  | { ok: true; operator_id: string; sessions_revoked: number }
  | AdminOperatorActionFailure;

export async function adminSuspendOperator(input: {
  operator_id: string;
  reason: string;
}): Promise<AdminSuspendOperatorResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminSuspendOperatorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_suspend_operator', {
    p_operator_id: parsed.data.operator_id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error('[operators.adminSuspendOperator] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as {
    ok: boolean;
    error?: string;
    sessions_revoked?: number;
  };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    operator_id: parsed.data.operator_id,
    sessions_revoked: result.sessions_revoked ?? 0,
  };
}

// ============================================================
// 4. adminUnsuspendOperator
// ============================================================

export type AdminUnsuspendOperatorResult =
  | { ok: true; operator_id: string }
  | AdminOperatorActionFailure;

export async function adminUnsuspendOperator(input: {
  operator_id: string;
}): Promise<AdminUnsuspendOperatorResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminUnsuspendOperatorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_unsuspend_operator', {
    p_operator_id: parsed.data.operator_id,
  });
  if (error) {
    console.error('[operators.adminUnsuspendOperator] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  revalidateOperator(parsed.data.operator_id);
  return { ok: true, operator_id: parsed.data.operator_id };
}

// ============================================================
// 5. adminSetOperatorDocuments
// ============================================================

export type AdminSetOperatorDocumentsResult =
  | { ok: true; operator_id: string }
  | AdminOperatorActionFailure;

export async function adminSetOperatorDocuments(input: {
  operator_id: string;
  commercial_registration?: string | null;
  gaca_license?: string | null;
  license_expiry?: string | null;
}): Promise<AdminSetOperatorDocumentsResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminSetOperatorDocumentsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_set_operator_documents', {
    p_operator_id: parsed.data.operator_id,
    p_commercial_registration: parsed.data.commercial_registration,
    p_gaca_license: parsed.data.gaca_license,
    p_license_expiry: parsed.data.license_expiry,
  });
  if (error) {
    console.error('[operators.adminSetOperatorDocuments] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  revalidateOperator(parsed.data.operator_id);
  return { ok: true, operator_id: parsed.data.operator_id };
}

// ============================================================
// 6. adminResetOperatorPassword
//
// Server Action receives plaintext password from form, bcrypts
// it (cost = 12 via bcryptjs — same shape as PR 2c login flow),
// then calls admin_reset_operator_password (which sets
// password_must_change=TRUE and revokes sessions). Sends an
// email with the plaintext so admin doesn't have to relay it
// manually.
// ============================================================

// Codex round 1 (PR #41) P1 #1 fix: result shape now exposes
// email-delivery status. When email_delivered=false the action
// returns the plaintext password in `manual_password` so admin
// can relay it via WhatsApp/SMS/voice; the UI surfaces a
// degraded warning instead of claiming success silently.
export type AdminResetOperatorPasswordResult =
  | {
      ok: true;
      operator_id: string;
      sessions_revoked: number;
      email_delivered: boolean;
      email_failure_reason?: 'env_missing' | 'send_failed' | 'operator_lookup_failed';
      manual_password?: string;
    }
  | AdminOperatorActionFailure;

export async function adminResetOperatorPassword(input: {
  operator_id: string;
  new_password: string;
}): Promise<AdminResetOperatorPasswordResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminResetOperatorPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // Bcrypt the plaintext (cost=12 ≈ 250-500ms on Vercel).
  let hash: string;
  try {
    hash = await bcrypt.hash(parsed.data.new_password, 12);
  } catch (err) {
    console.error('[operators.adminResetOperatorPassword] bcrypt failed', err);
    return { ok: false, error: 'bcrypt_failed' };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_reset_operator_password', {
    p_operator_id: parsed.data.operator_id,
    p_new_password_hash: hash,
  });
  if (error) {
    console.error('[operators.adminResetOperatorPassword] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as {
    ok: boolean;
    error?: string;
    sessions_revoked?: number;
  };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  // Look up operator email + send. Both can fail; either way
  // we MUST return the plaintext to admin so they can relay
  // manually. Without this the operator is locked out — the
  // password is rotated and sessions are revoked, but the
  // delivery silently no-op'd.
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('contact_email, company_name')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();

  let emailDelivered = false;
  let emailFailureReason:
    | 'env_missing'
    | 'send_failed'
    | 'operator_lookup_failed'
    | undefined;

  if (opErr || !opRow) {
    console.error(
      '[operators.adminResetOperatorPassword] operator lookup failed after reset',
      opErr
    );
    emailFailureReason = 'operator_lookup_failed';
  } else {
    const sendResult = await sendOperatorPasswordResetEmail({
      to: opRow.contact_email,
      company_name: opRow.company_name,
      new_password: parsed.data.new_password,
      login_url: `${siteUrl()}/operator/login`,
    });
    if (sendResult.ok) {
      emailDelivered = true;
    } else {
      emailFailureReason = sendResult.reason;
    }
    // Phase 8.1: this admin path was previously not reflected
    // in the singleton alert row (Phase 8 PR 2c chunk 2 only
    // wired the public reset path). Record here so the
    // /admin/operators banner fires for admin-side failures
    // too. WhatsApp is intentionally NOT used on this flow:
    // the body carries a plaintext temporary password, which is
    // safer to ship over Resend (encrypted at-rest, account-
    // bound) than over WhatsApp (screenshot-shareable, group-
    // forwardable). Magic-link reset (operatorRequestPassword
    // Reset) ships over both channels because it carries no
    // secret.
    await recordEmailAlertStatus(
      client,
      sendResult,
      'adminResetOperatorPassword'
    );
  }

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    operator_id: parsed.data.operator_id,
    sessions_revoked: result.sessions_revoked ?? 0,
    email_delivered: emailDelivered,
    email_failure_reason: emailDelivered ? undefined : emailFailureReason,
    manual_password: emailDelivered ? undefined : parsed.data.new_password,
  };
}

// ============================================================
// 7. adminMintOperatorOtp
//
// Generates a 6-digit numeric code, sha256 hashes it, calls
// mint_operator_otp (10-min TTL). Returns the PLAINTEXT code
// to admin so they can copy + paste into wa.me. The DB only
// holds the hash.
// ============================================================

// Codex round 1 PR #46 P1 fix: result shape extended with
// WhatsApp delivery status. The plaintext_code + whatsapp_phone
// pair is preserved as a manual fallback so the admin can still
// build a wa.me link when wasender is degraded (config_missing /
// rate_limited / send_failed / invalid_phone). On a healthy
// send, admin sees `whatsapp_delivered: true` and skips manual
// relay entirely.
export type AdminMintOperatorOtpResult =
  | {
      ok: true;
      otp_id: string;
      plaintext_code: string;
      whatsapp_phone?: string;
      expires_at: string;
      whatsapp_delivered: boolean;
      whatsapp_failure_reason?:
        | 'config_missing'
        | 'invalid_phone'
        | 'rate_limited'
        | 'send_failed'
        | 'operator_lookup_failed';
    }
  | AdminOperatorActionFailure;

const OTP_TTL_MINUTES = 10;

function generateSixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export async function adminMintOperatorOtp(input: {
  operator_id: string;
  purpose: 'login' | 'recovery';
}): Promise<AdminMintOperatorOtpResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminMintOperatorOtpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const plaintext = generateSixDigitCode();
  const codeHash = createHash('sha256').update(plaintext).digest('hex');
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  const client = createAdminClient();
  const { data, error } = await client.rpc('mint_operator_otp', {
    p_operator_id: parsed.data.operator_id,
    p_code_hash: codeHash,
    p_purpose: parsed.data.purpose,
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) {
    console.error('[operators.adminMintOperatorOtp] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as { ok: boolean; error?: string; otp_id?: string };
  if (!result.ok || !result.otp_id) {
    return { ok: false, error: result.error ?? 'unknown' };
  }

  // Look up phone + company_name. Codex round 1 PR #46 P1 fix:
  // we now ATTEMPT a wasender send here instead of just handing
  // the wa.me phone back to admin. plaintext_code is still
  // returned so admin can relay manually if delivery degrades
  // (config_missing / rate_limited / send_failed / invalid_phone)
  // — the OTP RPC has already minted the hash and the operator
  // needs the code one way or another.
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('contact_phone, company_name')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();

  let whatsappDelivered = false;
  let whatsappFailureReason:
    | 'config_missing'
    | 'invalid_phone'
    | 'rate_limited'
    | 'send_failed'
    | 'operator_lookup_failed'
    | undefined;

  if (opErr || !opRow) {
    console.error(
      '[operators.adminMintOperatorOtp] op fetch error after mint',
      opErr
    );
    whatsappFailureReason = 'operator_lookup_failed';
  } else {
    const sendResult = await sendOperatorOtpWhatsApp({
      to_phone: opRow.contact_phone,
      company_name: opRow.company_name,
      code: plaintext,
      purpose: parsed.data.purpose,
      expires_in_minutes: OTP_TTL_MINUTES,
    });
    if (sendResult.ok) {
      whatsappDelivered = true;
    } else {
      whatsappFailureReason = sendResult.reason;
    }
    await recordWhatsAppAlertStatus(
      client,
      sendResult,
      'adminMintOperatorOtp'
    );
  }

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    otp_id: result.otp_id,
    plaintext_code: plaintext,
    whatsapp_phone: opRow?.contact_phone ?? undefined,
    expires_at: expiresAt.toISOString(),
    whatsapp_delivered: whatsappDelivered,
    whatsapp_failure_reason: whatsappDelivered
      ? undefined
      : whatsappFailureReason,
  };
}

// ============================================================
// 8. adminUploadOperatorDocument
//
// Accepts a File via FormData. The replace-safe flow (Codex
// round 1 PR #41 P1 #2 fix) is:
//
//   1. Snapshot the existing row's storage_path (if any) BEFORE
//      any mutation so we can clean up the old object after the
//      new metadata commits.
//   2. Upload the new file to a fresh storage path
//      `operator-documents/<operator_id>/<document_type>/<random>-<safe_name>`.
//      Using a unique random suffix lets the old object stay
//      reachable until step 4.
//   3. UPSERT the metadata row on the unique
//      (operator_id, document_type) index — atomic at the SQL
//      boundary; on failure the existing row + old storage
//      object are untouched and we rollback only the
//      newly-uploaded storage object.
//   4. On UPSERT success: best-effort cleanup of the old
//      storage object. A cleanup failure leaves a dangling
//      object in the bucket but the operator still has a
//      working document; a future janitor can sweep.
//
// The unique index makes the upsert behave as REPLACE for the
// (operator, document_type) pair while preserving the row's
// `id` and `created_at` (good for the audit trail).
// ============================================================

const STORAGE_BUCKET = 'operator-documents';
const ALLOWED_MIME_PREFIXES = ['application/pdf', 'image/'] as const;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export type AdminUploadOperatorDocumentResult =
  | {
      ok: true;
      operator_id: string;
      document_id: string;
      storage_path: string;
    }
  | AdminOperatorActionFailure;

export async function adminUploadOperatorDocument(
  formData: FormData
): Promise<AdminUploadOperatorDocumentResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const operator_id = formData.get('operator_id');
  const document_type = formData.get('document_type');
  const file = formData.get('file');

  if (typeof operator_id !== 'string' || typeof document_type !== 'string') {
    return { ok: false, error: 'validation_failed' };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'file_required' };
  }

  const parsed = adminUploadOperatorDocumentSchema.safeParse({
    operator_id,
    document_type,
    file_name: file.name,
    file_size: file.size,
    content_type: file.type || 'application/octet-stream',
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // MIME check (defense in depth on top of Zod).
  if (!ALLOWED_MIME_PREFIXES.some((p) => parsed.data.content_type.startsWith(p))) {
    return { ok: false, error: 'unsupported_mime' };
  }
  if (parsed.data.file_size > MAX_FILE_BYTES) {
    return { ok: false, error: 'file_too_large' };
  }

  const client = createAdminClient();

  // Ensure operator exists + is in a writable state via the
  // admin_set_operator_documents RPC's contract (it'd reject
  // pending/approved-only). For uploads we don't need to set
  // text columns yet, so just verify operator exists.
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('id, signup_status')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();
  if (opErr) {
    console.error('[operators.adminUploadOperatorDocument] op lookup', opErr);
    return { ok: false, error: 'rpc_failed' };
  }
  if (!opRow) return { ok: false, error: 'operator_not_found' };
  if (!['pending', 'approved'].includes(opRow.signup_status)) {
    return { ok: false, error: 'not_writable' };
  }

  // Codex round 1 (PR #41) P1 #2 fix: snapshot the existing
  // storage_path BEFORE any mutation so we can clean it up
  // AFTER the new metadata row is committed. The previous
  // delete-then-insert pattern would lose the existing row
  // if the insert failed (no transaction across the two ops),
  // leaving the operator with no metadata for the required
  // document type.
  const { data: existing } = await client
    .from('operator_documents')
    .select('storage_path')
    .eq('operator_id', parsed.data.operator_id)
    .eq('document_type', parsed.data.document_type)
    .maybeSingle();
  const oldStoragePath = existing?.storage_path ?? null;

  // Upload the new file to a fresh path. We don't reuse the
  // old path because Supabase Storage `upsert: false` would
  // collide; using a unique random suffix lets the old file
  // stay reachable until we cleanup at the end.
  const safeName = parsed.data.file_name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  const randomSuffix = randomBytes(8).toString('hex');
  const storagePath = `${parsed.data.operator_id}/${parsed.data.document_type}/${randomSuffix}-${safeName}`;

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await client.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: parsed.data.content_type,
      upsert: false,
    });
  if (uploadErr) {
    console.error('[operators.adminUploadOperatorDocument] storage error', uploadErr);
    return { ok: false, error: 'upload_failed' };
  }

  // UPSERT metadata. The unique (operator_id, document_type)
  // index makes this an atomic UPDATE if a row exists, INSERT
  // otherwise — Supabase JS handles both via onConflict. The
  // existing row (if any) keeps its `id` and `created_at`,
  // which preserves the audit trail for the document type.
  const { data: upsertRow, error: upsertErr } = await client
    .from('operator_documents')
    .upsert(
      {
        operator_id: parsed.data.operator_id,
        document_type: parsed.data.document_type,
        storage_path: storagePath,
        file_name: parsed.data.file_name,
        file_size: parsed.data.file_size,
        content_type: parsed.data.content_type,
        uploaded_by_admin: true,
        uploaded_at: new Date().toISOString(),
      },
      { onConflict: 'operator_id,document_type' }
    )
    .select('id')
    .single();

  if (upsertErr) {
    console.error('[operators.adminUploadOperatorDocument] meta upsert error', upsertErr);
    // Rollback the new storage file so we don't leak orphans.
    // The existing metadata row + old storage file are
    // untouched (the upsert failed before mutating either).
    await client.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return { ok: false, error: 'meta_insert_failed' };
  }

  // Best-effort cleanup of the previous storage object now
  // that the new metadata row points at the new file. If this
  // fails the operator still has a working document — only a
  // dangling file remains in storage, which a future janitor
  // can sweep.
  if (oldStoragePath && oldStoragePath !== storagePath) {
    const { error: cleanupErr } = await client.storage
      .from(STORAGE_BUCKET)
      .remove([oldStoragePath]);
    if (cleanupErr) {
      console.warn(
        '[operators.adminUploadOperatorDocument] old storage cleanup failed (orphan left in bucket)',
        { oldStoragePath, error: cleanupErr.message }
      );
    }
  }

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    operator_id: parsed.data.operator_id,
    document_id: upsertRow.id,
    storage_path: storagePath,
  };
}

// ============================================================
// 9. adminConvertPhase7Stub
// ============================================================

export type AdminConvertPhase7StubResult =
  | {
      ok: true;
      stub_id: string;
      operator_id: string;
      legs_reassigned: number;
    }
  | AdminOperatorActionFailure;

export async function adminConvertPhase7Stub(input: {
  stub_id: string;
  operator_id: string;
}): Promise<AdminConvertPhase7StubResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminConvertPhase7StubSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('convert_phase7_stub_to_operator', {
    p_stub_id: parsed.data.stub_id,
    p_operator_id: parsed.data.operator_id,
  });
  if (error) {
    console.error('[operators.adminConvertPhase7Stub] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  const result = data as {
    ok: boolean;
    error?: string;
    stub_id?: string;
    operator_id?: string;
    legs_reassigned?: number;
  };
  if (!result.ok) return { ok: false, error: result.error ?? 'unknown' };

  revalidatePath('/admin/operators');
  revalidatePath(`/admin/operators/${parsed.data.operator_id}`);
  revalidatePath(`/admin/empty-legs/operators`);
  revalidatePath(`/admin/empty-legs/operators/${parsed.data.stub_id}/convert`);
  revalidatePath('/admin/empty-legs');

  return {
    ok: true,
    stub_id: parsed.data.stub_id,
    operator_id: parsed.data.operator_id,
    legs_reassigned: result.legs_reassigned ?? 0,
  };
}
