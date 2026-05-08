import { z } from 'zod';

/**
 * Phase 7 — Zod schemas for the Empty Legs admin Server
 * Action surface (PR 2b). Each schema mirrors the args of
 * the SECURITY DEFINER RPC it ultimately calls. Defense in
 * depth: the SQL layer also validates these fields and
 * returns a structured error per the §7.2 contract.
 *
 * Inputs are deliberately strict: optional UUIDs / IATA
 * codes accept either a non-empty value or `null`/`undefined`
 * (form fields submit empty strings, which are normalized
 * to `null` by the helper below).
 */

const optionalUuid = z
  .string()
  .uuid('uuid_invalid')
  .nullable()
  .optional();

const optionalText = z
  .string()
  .trim()
  .max(255, 'text_too_long')
  .nullable()
  .optional();

const optionalIata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'iata_invalid')
  .nullable()
  .optional();

const isoTimestamp = z
  .string()
  .min(1, 'datetime_required')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'datetime_invalid');

// ============================================================
// adminPublishEmptyLegSchema
// ============================================================

export const adminPublishEmptyLegSchema = z
  .object({
    operator_id: optionalUuid,
    operator_stub_id: optionalUuid,
    operator_name: optionalText,
    operator_phone: optionalText,
    operator_email: optionalText,
    aircraft_id: optionalUuid,
    aircraft_text: optionalText,
    parent_booking_id: optionalUuid,
    departure_airport_iata: optionalIata,
    departure_airport_freeform: optionalText,
    arrival_airport_iata: optionalIata,
    arrival_airport_freeform: optionalText,
    departure_window_start: isoTimestamp,
    departure_window_end: isoTimestamp,
    flexibility_hours: z
      .number()
      .int('flexibility_hours_invalid')
      .min(0, 'flexibility_hours_negative')
      .max(48, 'flexibility_hours_too_large')
      .nullable()
      .optional(),
    original_price: z
      .number()
      .positive('original_price_invalid')
      .max(10_000_000, 'original_price_too_large'),
    max_passengers: z
      .number()
      .int('max_passengers_invalid')
      .min(1, 'max_passengers_invalid')
      .max(19, 'max_passengers_invalid'),
    auction_initial_discount_pct: z
      .number()
      .min(10, 'auction_initial_out_of_range')
      .max(50, 'auction_initial_out_of_range')
      .nullable()
      .optional(),
    auction_floor_discount_pct: z
      .number()
      .min(50, 'auction_floor_out_of_range')
      .max(90, 'auction_floor_out_of_range')
      .nullable()
      .optional(),
    auction_curve: z
      .enum(['linear', 'accelerating'], {
        errorMap: () => ({ message: 'auction_curve_invalid' }),
      })
      .nullable()
      .optional(),
    auction_window_lead_hours: z
      .number()
      .int('auction_lead_hours_invalid')
      .min(0, 'auction_lead_hours_negative')
      .max(168, 'auction_lead_hours_too_large')
      .nullable()
      .optional(),
    suppress_notifications: z.boolean().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const hasDepIata =
      typeof value.departure_airport_iata === 'string' &&
      value.departure_airport_iata.length > 0;
    const hasDepFree =
      typeof value.departure_airport_freeform === 'string' &&
      value.departure_airport_freeform.length > 0;
    if (!hasDepIata && !hasDepFree) {
      ctx.addIssue({
        path: ['departure_airport_iata'],
        code: z.ZodIssueCode.custom,
        message: 'departure_route_missing',
      });
    }

    const hasArrIata =
      typeof value.arrival_airport_iata === 'string' &&
      value.arrival_airport_iata.length > 0;
    const hasArrFree =
      typeof value.arrival_airport_freeform === 'string' &&
      value.arrival_airport_freeform.length > 0;
    if (!hasArrIata && !hasArrFree) {
      ctx.addIssue({
        path: ['arrival_airport_iata'],
        code: z.ZodIssueCode.custom,
        message: 'arrival_route_missing',
      });
    }

    if (
      Date.parse(value.departure_window_end) <=
      Date.parse(value.departure_window_start)
    ) {
      ctx.addIssue({
        path: ['departure_window_end'],
        code: z.ZodIssueCode.custom,
        message: 'departure_window_invalid',
      });
    }

    const initial = value.auction_initial_discount_pct;
    const floor = value.auction_floor_discount_pct;
    if (
      typeof initial === 'number' &&
      typeof floor === 'number' &&
      floor <= initial
    ) {
      ctx.addIssue({
        path: ['auction_floor_discount_pct'],
        code: z.ZodIssueCode.custom,
        message: 'auction_floor_below_initial',
      });
    }
  });

export type AdminPublishEmptyLegInput = z.infer<
  typeof adminPublishEmptyLegSchema
>;

// ============================================================
// adminUpdatePriceSchema
// ============================================================

export const adminUpdatePriceSchema = z.object({
  leg_id: z.string().uuid('leg_id_invalid'),
  new_price: z
    .number()
    .positive('new_price_invalid')
    .max(10_000_000, 'new_price_too_large'),
});

export type AdminUpdatePriceInput = z.infer<typeof adminUpdatePriceSchema>;

// ============================================================
// adminCancelSchema
// ============================================================

export const adminCancelSchema = z.object({
  leg_id: z.string().uuid('leg_id_invalid'),
  reason: z
    .string()
    .trim()
    .max(500, 'reason_too_long')
    .nullable()
    .optional(),
});

export type AdminCancelInput = z.infer<typeof adminCancelSchema>;

// ============================================================
// adminMarkSoldManualSchema
// ============================================================

export const adminMarkSoldManualSchema = z.object({
  leg_id: z.string().uuid('leg_id_invalid'),
  customer_name: z
    .string()
    .trim()
    .min(1, 'customer_name_missing')
    .max(255, 'customer_name_too_long'),
  customer_phone: z
    .string()
    .trim()
    .min(6, 'customer_phone_missing')
    .max(32, 'customer_phone_too_long'),
});

export type AdminMarkSoldManualInput = z.infer<
  typeof adminMarkSoldManualSchema
>;

// ============================================================
// adminConfirmReservationSchema
// ============================================================

/**
 * Codex spec §7.3 Case 2 names a "تأكيد الحجز" button that
 * calls a manual confirm Server Action. The RPC
 * `confirm_empty_leg_reservation(p_leg_id, p_token_hash)`
 * requires the customer's reservation token. The admin
 * receives the token over WhatsApp from the customer and
 * pastes it here. The Server Action sha256-hashes the
 * raw token before calling the RPC so the wire format
 * matches what `reserve_empty_leg` stored.
 */
export const adminConfirmReservationSchema = z.object({
  leg_id: z.string().uuid('leg_id_invalid'),
  token: z
    .string()
    .trim()
    .min(1, 'reservation_token_missing')
    .max(512, 'reservation_token_too_long'),
});

export type AdminConfirmReservationInput = z.infer<
  typeof adminConfirmReservationSchema
>;

// ============================================================
// adminReleaseReservationSchema
// ============================================================

export const adminReleaseReservationSchema = z.object({
  leg_id: z.string().uuid('leg_id_invalid'),
});

export type AdminReleaseReservationInput = z.infer<
  typeof adminReleaseReservationSchema
>;

// ============================================================
// markOutreachSentSchema
// ============================================================

export const markOutreachSentSchema = z.object({
  notification_id: z.string().uuid('notification_id_invalid'),
});

export type MarkOutreachSentInput = z.infer<typeof markOutreachSentSchema>;
