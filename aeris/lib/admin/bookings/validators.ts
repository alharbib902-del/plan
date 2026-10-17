import { z } from 'zod';

import { FLIGHT_STATUSES } from './constants';

/**
 * Zod schemas for the admin bookings Server Actions
 * (app/(admin)/admin/actions/bookings.ts). Shape-only: every business
 * rule (unpaid state, amount = net due, allowed transitions, paid before
 * completion) is enforced again inside the SECURITY DEFINER RPCs.
 * Messages are error CODES, mapped to Arabic by bookingActionErrorAr.
 */

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * Admins type amounts by hand (possibly with thousands separators or an
 * Arabic keyboard). Normalise to a plain latin-digit decimal string so the
 * RPC parses it exactly (TEXT → NUMERIC inside the DB).
 */
export function normalizeAmountInput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  return raw
    .replace(ARABIC_INDIC_DIGITS, (d) => {
      const code = d.charCodeAt(0);
      const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
      return String(code - base);
    })
    .replace(/[٫]/g, '.')
    .replace(/[,٬\s]/g, '');
}

const noteField = z
  .string()
  .trim()
  .max(500, 'note_too_long')
  .optional()
  .transform((v) => (v ? v : undefined));

export const confirmOfflinePaymentSchema = z.object({
  booking_id: z.string().uuid('booking_not_found'),
  received_amount: z.preprocess(
    normalizeAmountInput,
    z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'amount_invalid')
      .refine((v) => Number(v) > 0, 'amount_invalid')
  ),
  reference: z
    .string()
    .trim()
    .min(1, 'reference_required')
    .max(120, 'reference_too_long'),
  note: noteField,
});

export type ConfirmOfflinePaymentInput = z.infer<
  typeof confirmOfflinePaymentSchema
>;

export const setFlightStatusSchema = z
  .object({
    booking_id: z.string().uuid('booking_not_found'),
    status: z.enum(FLIGHT_STATUSES, {
      errorMap: () => ({ message: 'status_required' }),
    }),
    note: noteField,
  })
  .superRefine((value, ctx) => {
    if (value.status === 'cancelled' && !value.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'cancel_reason_required',
      });
    }
  });

export type SetFlightStatusInput = z.infer<typeof setFlightStatusSchema>;

/** Flattens Zod issues to { field: code } for the client forms. */
export function fieldErrorsFromIssues(
  issues: readonly { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join('.');
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
