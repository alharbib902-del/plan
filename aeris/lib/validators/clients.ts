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

// ============================================================
// 7. createAuthenticatedTripRequest (Phase 9 PR 2)
// ============================================================
//
// Mirrors the SQL contract of `create_authenticated_trip_request`.
// The DB enforces every rule below as a defence-in-depth structured
// contract; Zod gives the form a friendlier error path before the
// network round-trip.

const iataSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, {
    message: 'كود المطار يجب أن يكون 3 أحرف لاتينية (مثل: RUH)',
  });

const isoDatetimeSchema = z
  .string()
  .min(1, { message: 'التاريخ مطلوب' })
  .refine(
    (value) => {
      const d = new Date(value);
      return Number.isFinite(d.getTime());
    },
    { message: 'التاريخ غير صالح' }
  );

const tripLegSchema = z.object({
  from: iataSchema,
  to: iataSchema,
  date: isoDatetimeSchema,
  // Optional time-of-day hint kept as free string so client
  // can pass either ISO time ('14:30') or local-format. The
  // RPC only persists the array verbatim into trip_requests.legs.
  time: z
    .string()
    .trim()
    .max(8, { message: 'التوقيت غير صالح' })
    .optional()
    .nullable(),
});

export const createTripRequestSchema = z
  .object({
    legs: z
      .array(tripLegSchema)
      .min(1, { message: 'يجب إضافة قطعة طيران واحدة على الأقل' })
      .max(8, { message: 'الحد الأقصى 8 قطع طيران' }),
    departure_iata: iataSchema,
    arrival_iata: iataSchema,
    departure_date: isoDatetimeSchema,
    return_date: isoDatetimeSchema.optional().nullable(),
    passengers: z
      .number()
      .int({ message: 'عدد الركاب يجب أن يكون رقماً صحيحاً' })
      .min(1, { message: 'يجب أن يكون هناك راكب واحد على الأقل' })
      .max(19, { message: 'الحد الأقصى 19 راكباً' }),
    aircraft_pref: z
      .enum(['light', 'mid', 'super_mid', 'heavy', 'long_range'])
      .optional()
      .nullable(),
    special_requests: z
      .string()
      .trim()
      .max(2000, {
        message: 'الطلبات الخاصة يجب أن تكون أقل من 2000 حرف',
      })
      .optional()
      .nullable(),
  })
  // Cross-field refinement: return_date must strictly exceed
  // departure_date when present. Mirrors the RPC's
  // invalid_return_date contract — caught here so the form
  // can highlight the return field directly.
  .refine(
    (input) => {
      if (!input.return_date) return true;
      const dep = new Date(input.departure_date).getTime();
      const ret = new Date(input.return_date).getTime();
      if (!Number.isFinite(dep) || !Number.isFinite(ret)) return true;
      return ret > dep;
    },
    {
      message: 'تاريخ العودة يجب أن يكون بعد تاريخ المغادرة',
      path: ['return_date'],
    }
  )
  // Departure date must strictly be in the future. The RPC
  // enforces NOW() too; Zod gives a friendlier error.
  .refine(
    (input) => {
      const dep = new Date(input.departure_date).getTime();
      if (!Number.isFinite(dep)) return true;
      return dep > Date.now();
    },
    {
      message: 'تاريخ المغادرة يجب أن يكون في المستقبل',
      path: ['departure_date'],
    }
  );

export type CreateTripRequestInput = z.infer<
  typeof createTripRequestSchema
>;

// ============================================================
// 8. cancelMyTripRequest (Phase 9 PR 2)
// ============================================================

export const cancelTripRequestSchema = z.object({
  trip_request_id: z.string().uuid({
    message: 'معرّف الطلب غير صالح',
  }),
});

export type CancelTripRequestInput = z.infer<
  typeof cancelTripRequestSchema
>;

// ============================================================
// 9. clientAcceptOffer (Phase 9 PR 3)
// ============================================================
//
// Mirrors the Phase 5/6 unified `accept_offer(p_source, p_offer_id)`
// RPC contract. The Server Action layer adds an ownership pre-check
// (the offer's parent trip must be owned by the calling client) on
// top of this validator.

export const offerSourceSchema = z.enum(['phase4', 'phase5']);

export const acceptOfferSchema = z.object({
  offer_id: z.string().uuid({
    message: 'معرّف العرض غير صالح',
  }),
  source: offerSourceSchema,
});

export type AcceptOfferInput = z.infer<typeof acceptOfferSchema>;

// ============================================================
// 10. clientDeclineOffer (Phase 9 PR 3)
// ============================================================

export const declineOfferSchema = z.object({
  offer_id: z.string().uuid({
    message: 'معرّف العرض غير صالح',
  }),
  source: offerSourceSchema,
});

export type DeclineOfferInput = z.infer<typeof declineOfferSchema>;
