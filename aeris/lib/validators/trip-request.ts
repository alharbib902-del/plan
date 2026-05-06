import { z } from 'zod';

export const TRIP_TYPES = ['one_way', 'round_trip', 'multi_city'] as const;
export type TripTypeOption = (typeof TRIP_TYPES)[number];

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// Phase 6.0 PR 2 (S3): the form submits `<side>_iata` AND
// `<side>_freeform` from the AirportCombobox — both hidden
// inputs are always rendered, so the unselected side arrives
// as an empty string. We MUST preprocess empty/whitespace-only
// strings to `null` BEFORE any regex / min-length check runs;
// otherwise picking freeform produces `origin_iata = ''` which
// fails the IATA regex with `origin_iata_invalid` and the
// "exactly one of" refinement never gets a chance to surface
// the real signal. The form only renders `errors.origin` /
// `errors.destination` (refinement-path errors), so the
// origin_iata_invalid would also be invisible to the user.
// Per Codex P1 review of PR #16.
//
// The Server Action looks up the IATA's display label before
// persisting (so `lead_inquiries.origin` / `destination`
// continue to carry a human-readable string for back-compat —
// see the spec's Schema reality section).
const stripEmpty = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const iataField = (invalidCode: string) =>
  z.preprocess(
    stripEmpty,
    z
      .string()
      .regex(/^[A-Z]{3}$/, invalidCode)
      .nullable()
      .optional()
  );

const freeformField = (tooShortCode: string, tooLongCode: string) =>
  z.preprocess(
    stripEmpty,
    z
      .string()
      .min(2, tooShortCode)
      .max(120, tooLongCode)
      .nullable()
      .optional()
  );

export const flightRequestSchema = z
  .object({
    origin_iata: iataField('origin_iata_invalid'),
    origin_freeform: freeformField(
      'origin_freeform_too_short',
      'origin_freeform_too_long'
    ),
    destination_iata: iataField('destination_iata_invalid'),
    destination_freeform: freeformField(
      'destination_freeform_too_short',
      'destination_freeform_too_long'
    ),
    departureDate: z
      .string({ required_error: 'departure_required' })
      .min(1, 'departure_required')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'departure_invalid')
      .refine((v) => new Date(v) >= todayStart(), 'departure_in_past'),
    returnDate: z
      .string()
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined))
      .refine(
        (v) => v === undefined || !Number.isNaN(Date.parse(v)),
        'return_invalid'
      ),
    passengers: z.coerce
      .number({ invalid_type_error: 'passengers_invalid' })
      .int('passengers_invalid')
      .min(1, 'passengers_min')
      .max(19, 'passengers_max'),
    tripType: z.enum(TRIP_TYPES, {
      required_error: 'trip_type_required',
      invalid_type_error: 'trip_type_invalid',
    }),
    customerName: z
      .string({ required_error: 'name_required' })
      .trim()
      .min(2, 'name_too_short')
      .max(120, 'name_too_long'),
    customerPhone: z
      .string({ required_error: 'phone_required' })
      .trim()
      .min(7, 'phone_too_short')
      .max(20, 'phone_too_long')
      .regex(/^[+\d\s-]+$/, 'phone_invalid'),
    notes: z.string().trim().max(1000, 'notes_too_long').optional(),
  })
  .refine(
    (data) => {
      if (data.tripType !== 'round_trip') return true;
      if (!data.returnDate) return false;
      return new Date(data.returnDate) >= new Date(data.departureDate);
    },
    {
      message: 'return_before_departure',
      path: ['returnDate'],
    }
  )
  // Phase 6.0 PR 2 (S3): exactly one of origin_iata /
  // origin_freeform required. Two refinements per side give
  // distinct error codes for "neither" vs "both" (acceptance
  // #4 and #5).
  .refine((data) => !(data.origin_iata && data.origin_freeform), {
    message: 'origin_ambiguous',
    path: ['origin'],
  })
  .refine((data) => Boolean(data.origin_iata) || Boolean(data.origin_freeform), {
    message: 'origin_required',
    path: ['origin'],
  })
  .refine(
    (data) => !(data.destination_iata && data.destination_freeform),
    { message: 'destination_ambiguous', path: ['destination'] }
  )
  .refine(
    (data) =>
      Boolean(data.destination_iata) || Boolean(data.destination_freeform),
    { message: 'destination_required', path: ['destination'] }
  );

export type FlightRequestInput = z.infer<typeof flightRequestSchema>;
