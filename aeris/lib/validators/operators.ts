import { z } from 'zod';

/**
 * Phase 8 — Zod schemas for the 9 admin Server Actions in
 * `app/actions/operators.ts`. Each schema mirrors the
 * structured-error contract of the underlying SECURITY
 * DEFINER RPC (PR 2a §4.2).
 *
 * Validation philosophy:
 *   - Arabic + English-acceptable for free-form text fields
 *     (company_name, reasons, notes)
 *   - email + phone shapes match the PR 2a `operator_signup`
 *     RPC pattern (RFC-shape regex + 6..20 char phone)
 *   - bcrypt hashes are 60-char, $2[aby]$ prefixed
 *   - sha256 hashes are 64-char lowercase hex (matching
 *     `_is_sha256_hex` in the migration)
 *   - regulatory text fields (commercial_registration,
 *     gaca_license) are loose strings — admin can record
 *     whatever the document says
 */

// ============================================================
// Shared primitives
// ============================================================

export const operatorIdSchema = z.string().uuid({
  message: 'operator_id must be a UUID',
});

export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, {
    message: 'must be a 64-character lowercase hex sha256 hash',
  });

export const bcryptHashSchema = z
  .string()
  .length(60)
  .regex(/^\$2[aby]\$/, {
    message: 'must be a bcrypt hash ($2a$ / $2b$ / $2y$ prefix)',
  });

export const reasonSchema = z
  .string()
  .trim()
  .min(1, { message: 'السبب مطلوب' })
  .max(2000, { message: 'السبب طويل جداً (أقصى 2000 حرف)' });

// ============================================================
// 1. adminApproveOperator
//
// Server Action mints the welcome token client-side and passes
// the sha256 hash + 7-day expiry to admin_approve_operator. The
// schema validates only the operator id; the token is derived
// inside the action.
// ============================================================

export const adminApproveOperatorSchema = z.object({
  operator_id: operatorIdSchema,
});

// ============================================================
// 2. adminRejectOperator
// ============================================================

export const adminRejectOperatorSchema = z.object({
  operator_id: operatorIdSchema,
  reason: reasonSchema,
});

// ============================================================
// 3. adminSuspendOperator
// ============================================================

export const adminSuspendOperatorSchema = z.object({
  operator_id: operatorIdSchema,
  reason: reasonSchema,
});

// ============================================================
// 4. adminUnsuspendOperator
// ============================================================

export const adminUnsuspendOperatorSchema = z.object({
  operator_id: operatorIdSchema,
});

// ============================================================
// 5. adminSetOperatorDocuments
//
// All three columns are nullable on the RPC side (NULL params
// leave existing values unchanged). The schema accepts empty
// strings + maps them to null so the form can submit blank
// fields without forcing the admin to clear-then-set.
// ============================================================

const optionalRegistrationField = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const optionalLicenseExpiry = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'license_expiry must be YYYY-MM-DD',
  })
  .optional()
  .or(z.literal(''))
  .transform((v) => (v && v.length > 0 ? v : null));

export const adminSetOperatorDocumentsSchema = z.object({
  operator_id: operatorIdSchema,
  commercial_registration: optionalRegistrationField,
  gaca_license: optionalRegistrationField,
  license_expiry: optionalLicenseExpiry,
});

// ============================================================
// 6. adminResetOperatorPassword
//
// Server Action receives the plaintext password from the form,
// bcrypts it, then calls the RPC. The schema enforces password
// strength on the plaintext (length + alphanumeric mix);
// bcrypt-format validation lives on the RPC side.
// ============================================================

export const adminResetOperatorPasswordSchema = z.object({
  operator_id: operatorIdSchema,
  new_password: z
    .string()
    .min(10, { message: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل' })
    .max(128, { message: 'كلمة المرور طويلة جداً (أقصى 128 حرفاً)' })
    .regex(/[A-Za-z]/, { message: 'كلمة المرور يجب أن تحتوي حرفاً واحداً على الأقل' })
    .regex(/[0-9]/, { message: 'كلمة المرور يجب أن تحتوي رقماً واحداً على الأقل' }),
});

// ============================================================
// 7. adminMintOperatorOtp
//
// Server Action generates a 6-digit numeric code, sha256s it,
// and passes the hash to mint_operator_otp. The schema only
// gates the operator id + purpose; the code is internal.
// ============================================================

export const adminMintOperatorOtpSchema = z.object({
  operator_id: operatorIdSchema,
  purpose: z.enum(['login', 'recovery']),
});

// ============================================================
// 8. adminUploadOperatorDocument
//
// Server Action receives a File via FormData (Next.js native).
// The schema validates the operator id + document type +
// metadata; the file body is validated separately (size limit
// + MIME type) inside the action because Zod cannot reach
// into FormData blobs.
// ============================================================

export const operatorDocumentTypeEnum = z.enum([
  'commercial_registration',
  'gaca_license',
  'license_expiry_proof',
]);

export const adminUploadOperatorDocumentSchema = z.object({
  operator_id: operatorIdSchema,
  document_type: operatorDocumentTypeEnum,
  file_name: z.string().min(1).max(255),
  file_size: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024, {
      message: 'الملف أكبر من 20 ميغابايت',
    }),
  content_type: z.string().min(1).max(100),
});

// ============================================================
// 9. adminConvertPhase7Stub
// ============================================================

export const adminConvertPhase7StubSchema = z.object({
  stub_id: z.string().uuid(),
  operator_id: operatorIdSchema,
});

// ============================================================
// Inferred input types — re-exported so Server Actions and
// the admin forms share a single source of truth.
// ============================================================

export type AdminApproveOperatorInput = z.infer<typeof adminApproveOperatorSchema>;
export type AdminRejectOperatorInput = z.infer<typeof adminRejectOperatorSchema>;
export type AdminSuspendOperatorInput = z.infer<typeof adminSuspendOperatorSchema>;
export type AdminUnsuspendOperatorInput = z.infer<typeof adminUnsuspendOperatorSchema>;
export type AdminSetOperatorDocumentsInput = z.infer<typeof adminSetOperatorDocumentsSchema>;
export type AdminResetOperatorPasswordInput = z.infer<typeof adminResetOperatorPasswordSchema>;
export type AdminMintOperatorOtpInput = z.infer<typeof adminMintOperatorOtpSchema>;
export type AdminUploadOperatorDocumentInput = z.infer<typeof adminUploadOperatorDocumentSchema>;
export type AdminConvertPhase7StubInput = z.infer<typeof adminConvertPhase7StubSchema>;
