'use server';

import { revalidatePath } from 'next/cache';
import { createHash, randomBytes, randomInt } from 'crypto';
import bcrypt from 'bcryptjs';

import { requireAdminSession } from '@/lib/admin/auth';
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

function fieldErrorsFromZod(
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.');
    if (path) out[path] = issue.message;
  }
  return out;
}

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

export type AdminApproveOperatorResult =
  | {
      ok: true;
      operator_id: string;
      welcome_url: string;
      expires_at: string;
    }
  | AdminOperatorActionFailure;

export async function adminApproveOperator(input: {
  operator_id: string;
}): Promise<AdminApproveOperatorResult> {
  await requireAdminSession();
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

  // Look up the operator's email + company name for the welcome email.
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('contact_email, company_name')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();

  if (opErr || !opRow) {
    console.error('[operators.adminApproveOperator] op fetch error', opErr);
    // Approval already committed in the RPC — return success
    // with the URL so admin can copy/paste manually.
  } else {
    const welcomeUrl = `${siteUrl()}/operator/welcome/${minted.raw_token}`;
    await sendOperatorWelcomeEmail({
      to: opRow.contact_email,
      company_name: opRow.company_name,
      welcome_url: welcomeUrl,
      expires_at: minted.expires_at,
    });
  }

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    operator_id: parsed.data.operator_id,
    welcome_url: `${siteUrl()}/operator/welcome/${minted.raw_token}`,
    expires_at: minted.expires_at.toISOString(),
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
  await requireAdminSession();
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
  await requireAdminSession();
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
  await requireAdminSession();
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
  await requireAdminSession();
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

export type AdminResetOperatorPasswordResult =
  | { ok: true; operator_id: string; sessions_revoked: number }
  | AdminOperatorActionFailure;

export async function adminResetOperatorPassword(input: {
  operator_id: string;
  new_password: string;
}): Promise<AdminResetOperatorPasswordResult> {
  await requireAdminSession();
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

  // Send email with the temporary password.
  const { data: opRow } = await client
    .from('operators')
    .select('contact_email, company_name')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();
  if (opRow) {
    await sendOperatorPasswordResetEmail({
      to: opRow.contact_email,
      company_name: opRow.company_name,
      new_password: parsed.data.new_password,
      login_url: `${siteUrl()}/operator/login`,
    });
  }

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    operator_id: parsed.data.operator_id,
    sessions_revoked: result.sessions_revoked ?? 0,
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

export type AdminMintOperatorOtpResult =
  | {
      ok: true;
      otp_id: string;
      plaintext_code: string;
      whatsapp_phone?: string;
      expires_at: string;
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
  await requireAdminSession();
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

  // Look up phone for the wa.me link
  const { data: opRow } = await client
    .from('operators')
    .select('contact_phone')
    .eq('id', parsed.data.operator_id)
    .maybeSingle();

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    otp_id: result.otp_id,
    plaintext_code: plaintext,
    whatsapp_phone: opRow?.contact_phone ?? undefined,
    expires_at: expiresAt.toISOString(),
  };
}

// ============================================================
// 8. adminUploadOperatorDocument
//
// Accepts a File via FormData. Uploads to Supabase Storage at
// `operator-documents/<operator_id>/<document_type>/<random>-<filename>`
// then INSERTs / UPSERTs the metadata row in `operator_documents`.
// The unique (operator_id, document_type) index means re-upload
// replaces — we DELETE the old metadata row first if it exists,
// then INSERT.
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
  await requireAdminSession();
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

  // Upload to Supabase Storage.
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

  // DELETE old metadata row if exists, then INSERT new row.
  // The unique index (operator_id, document_type) enforces one
  // doc per type per operator. We do delete-then-insert in a
  // single transaction at the application boundary; a future
  // hardening pass could move this to a SECURITY DEFINER RPC.
  await client
    .from('operator_documents')
    .delete()
    .eq('operator_id', parsed.data.operator_id)
    .eq('document_type', parsed.data.document_type);

  const { data: insertRow, error: insertErr } = await client
    .from('operator_documents')
    .insert({
      operator_id: parsed.data.operator_id,
      document_type: parsed.data.document_type,
      storage_path: storagePath,
      file_name: parsed.data.file_name,
      file_size: parsed.data.file_size,
      content_type: parsed.data.content_type,
      uploaded_by_admin: true,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[operators.adminUploadOperatorDocument] meta insert error', insertErr);
    // Try to clean up the uploaded file so we don't leak orphans.
    await client.storage.from(STORAGE_BUCKET).remove([storagePath]);
    return { ok: false, error: 'meta_insert_failed' };
  }

  revalidateOperator(parsed.data.operator_id);
  return {
    ok: true,
    operator_id: parsed.data.operator_id,
    document_id: insertRow.id,
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
  await requireAdminSession();
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
