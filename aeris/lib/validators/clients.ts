import { z } from 'zod';

/**
 * Phase 9 PR 1 — Zod schemas for the 8 client-side Server
 * Actions in `app/actions/clients-public.ts`.
 *
 * Validation philosophy mirrors `lib/validators/operators.ts`:
 *   - Email + phone shapes match the RPC `client_signup`
 *     contract (RFC-shape regex + 6..20 char phone)
 *   - Password minimum 10 chars per CLAUDE.md security
 *     conventions; max 128 to keep bcrypt input bounded
 *   - Arabic full_name accepted (no enforced character class)
 *   - sha256-hex tokens are 64-char lowercase hex (matches
 *     the shared Phase 8 `_is_sha256_hex` SQL guard)
 */

export const clientIdSchema = z.string().uuid({
  message: 'client_id must be a UUID',
});

export const emailSchema = z
  .string()
  .trim()
  .min(3, { message: 'البريد الإلكتروني مطلوب' })
  .max(120, { message: 'البريد الإلكتروني طويل جداً' })
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: 'صيغة البريد الإلكتروني غير صحيحة',
  });

export const phoneSchema = z
  .string()
  .trim()
  .min(6, { message: 'رقم الجوال قصير جداً' })
  .max(20, { message: 'رقم الجوال طويل جداً' });

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'الاسم الكامل قصير جداً' })
  .max(120, { message: 'الاسم الكامل طويل جداً' });

export const passwordPlaintextSchema = z
  .string()
  .min(10, { message: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل' })
  .max(128, { message: 'كلمة المرور طويلة جداً' })
  .regex(/[A-Za-z]/, {
    message: 'كلمة المرور يجب أن تحوي حرفاً واحداً على الأقل',
  })
  .regex(/[0-9]/, {
    message: 'كلمة المرور يجب أن تحوي رقماً واحداً على الأقل',
  });

export const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, {
  message: 'يجب أن يكون hash بصيغة sha256 (64 حرف hex)',
});

// ============================================================
// 1. clientSignup
// ============================================================

export const clientSignupSchema = z.object({
  email: emailSchema,
  password: passwordPlaintextSchema,
  full_name: fullNameSchema,
  phone: phoneSchema,
  marketing_opt_in: z.boolean(),
});

export type ClientSignupInput = z.infer<typeof clientSignupSchema>;

// ============================================================
// 2. clientLogin
// ============================================================

export const clientLoginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, { message: 'كلمة المرور مطلوبة' })
    .max(128),
  remember_me: z.boolean(),
});

export type ClientLoginInput = z.infer<typeof clientLoginSchema>;

// ============================================================
// 3. clientRequestPasswordReset
// ============================================================

export const clientRequestPasswordResetSchema = z.object({
  email: emailSchema,
});

export type ClientRequestPasswordResetInput = z.infer<
  typeof clientRequestPasswordResetSchema
>;

// ============================================================
// 4. clientVerifyPasswordReset
// ============================================================

export const clientVerifyPasswordResetSchema = z.object({
  token: z.string().min(1, { message: 'الرابط غير صالح' }),
  new_password: passwordPlaintextSchema,
});

export type ClientVerifyPasswordResetInput = z.infer<
  typeof clientVerifyPasswordResetSchema
>;

// ============================================================
// 5. clientChangePassword
// ============================================================

export const clientChangePasswordSchema = z.object({
  current_password: z
    .string()
    .min(1, { message: 'كلمة المرور الحالية مطلوبة' })
    .max(128),
  new_password: passwordPlaintextSchema,
});

export type ClientChangePasswordInput = z.infer<
  typeof clientChangePasswordSchema
>;

// ============================================================
// 6. clientUpdateProfile
// ============================================================

export const clientUpdateProfileSchema = z.object({
  full_name: fullNameSchema,
  phone: phoneSchema,
  marketing_opt_in: z.boolean(),
});

export type ClientUpdateProfileInput = z.infer<
  typeof clientUpdateProfileSchema
>;
