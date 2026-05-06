/**
 * Phase 6.1 — structured customer preferences for the
 * `trip_requests.preferences` JSONB and the new
 * `lead_inquiries.preferences` JSONB.
 *
 * Canonical storage rule (Phase 6.1 spec iteration 4):
 *
 *   No preference expressed = key OMITTED from the JSONB.
 *
 *   - Boolean preferences (halal / prayer_setup /
 *     elderly_assistance): `true` and `false` are both
 *     EXPLICIT user choices. `true` = "I require this".
 *     `false` = "I explicitly opt out". Key absent = "no
 *     preference expressed". The matching engine (future
 *     phase) distinguishes these three states.
 *   - Non-boolean preferences (string, number, array): the
 *     key is present iff the user set a non-empty value,
 *     absent otherwise.
 *   - `null` is NEVER stored by app writers. The Zod schema
 *     below rejects null on every field. The
 *     `mergeTripPreferences` helper strips any incoming
 *     null / undefined / empty-array / empty-string before
 *     merging.
 *
 * The `lead_trip_type` legacy key is preserved verbatim by
 * `mergeTripPreferences` — it's injected by
 * `promote_lead_to_trip_request` after the merge, but the
 * helper still tolerates it on input so admin code that
 * round-trips the existing JSONB doesn't accidentally drop
 * it.
 */

import { z } from 'zod';

/** ISO 3166-1 alpha-2 — exactly two uppercase letters. */
const ISO_3166_ALPHA2 = /^[A-Z]{2}$/;
/** ISO 639-1 — exactly two lowercase letters. */
const ISO_639_1 = /^[a-z]{2}$/;

const isoCountrySchema = z
  .string()
  .regex(ISO_3166_ALPHA2, 'preferences_country_code_invalid');

const isoLanguageSchema = z
  .string()
  .regex(ISO_639_1, 'preferences_language_code_invalid');

/**
 * Strict Zod schema for the JSONB shape. Every field is
 * `.optional()` (key may be absent). `.strict()` rejects
 * unknown keys. Empty arrays / empty strings / out-of-range
 * numbers are rejected explicitly so no useless data lands
 * in the store.
 */
export const tripPreferencesSchema = z
  .object({
    // Pilot
    pilot_nationality: isoCountrySchema.optional(),

    // Crew (soft preferences — multiple values allowed)
    crew_gender_preference: z
      .enum(['male', 'female', 'no_preference'])
      .optional(),
    crew_nationalities: z.array(isoCountrySchema).min(1).optional(),
    crew_languages: z.array(isoLanguageSchema).min(1).optional(),

    // Religious / dietary — `false` = explicit "No", absent = "no preference"
    halal: z.boolean().optional(),
    prayer_setup: z.boolean().optional(),

    // Accessibility / family
    // child_seats forbidden = 0 — use omission instead (the
    // canonical "no preference expressed" signal).
    child_seats: z.number().int().min(1).max(3).optional(),
    elderly_assistance: z.boolean().optional(),
    medical_notes: z.string().min(1).max(200).optional(),

    // Pre-existing legacy key — preserved verbatim by
    // mergeTripPreferences. Tolerated on input so round-trip
    // operations don't drop it.
    lead_trip_type: z.enum(['one_way', 'round_trip', 'multi_city']).optional(),
  })
  .strict();

export type TripPreferences = z.infer<typeof tripPreferencesSchema>;

/**
 * Merge two `TripPreferences` objects, stripping null /
 * undefined / empty-string / empty-array values from
 * `incoming` BEFORE merging. `incoming` keys win on
 * collision (last-write-wins).
 *
 * Used by:
 *   - The /request Server Action when submitting a
 *     preferences payload to `lead_inquiries.preferences`.
 *   - The admin promote-lead Server Action when the
 *     founder amends the customer's preferences before
 *     promotion.
 *
 * The `lead_trip_type` key is treated like any other:
 * if `existing` has it and `incoming` doesn't override it,
 * it survives. The promote RPC's own
 * `jsonb_build_object('lead_trip_type', p_lead_trip_type)`
 * injection is the canonical writer of that key after
 * promote.
 */
export function mergeTripPreferences(
  existing: TripPreferences,
  incoming: TripPreferences
): TripPreferences {
  const result: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key] = value;
  }

  return result as TripPreferences;
}
