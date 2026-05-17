import { z } from 'zod';

/**
 * Phase 12 PR 2 — Zod schemas for the Aeris Shield subscription
 * Server Actions (subscribeToAerisShield + admin activate).
 *
 * Owner DOB (D5 + Round 6 P1 #3): required at signup because
 * the clients table has no date_of_birth column. The §4.8
 * `subscribe_to_aeris_shield` RPC seeds the owner as a
 * `relationship='self'` entry in covered_members using this
 * value, then §4.7 consume_aeris_shield_event looks up the
 * stable (name, dob) pair when the owner uses a covered event.
 *
 * Covered members shape:
 *   [{ name: TEXT, relationship: TEXT, dob: 'YYYY-MM-DD' }]
 * Must be unique on (lower(BTRIM(name)), dob) per D5; the RPC
 * enforces this via safe_parse_date (§3.11) at write time.
 */

// Round 2 PR #77 P2 #3 fix — re-exported so the Shield
// routing schema in lib/medevac/shield-routing.ts can reuse
// the same strict DOB contract. The §4.7
// `consume_aeris_shield_event(..., p_patient_member_dob DATE, ...)`
// argument is cast by Postgres BEFORE the function body runs;
// a shape-valid-but-overflowing date like "2026-02-31" would
// fail at argument binding with `datetime_field_overflow`
// (SQLSTATE 22008), bubbling a raw PG error instead of the
// intended `patient_dob_invalid` structured response. The
// Server Action must reject these BEFORE the .rpc() call.
export const isoBirthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صحيح (YYYY-MM-DD)')
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return false;
      // Reject shape-valid-but-overflowing dates like 2026-02-31
      // (mirrors §3.11 safe_parse_date semantics so the form
      // surface and the DB agree on what's valid).
      const [y, m, day] = s.split('-').map(Number);
      return (
        d.getUTCFullYear() === y &&
        d.getUTCMonth() + 1 === m &&
        d.getUTCDate() === day
      );
    },
    { message: 'تاريخ غير صحيح' }
  )
  .refine((s) => Date.parse(s) <= Date.now(), {
    message: 'تاريخ الميلاد لا يكون في المستقبل',
  });

// Backwards-compatible alias for the existing local users
// of `isoDateSchema` in this file (covered_member +
// owner_dob). Kept private; new callers should import
// `isoBirthDateSchema` directly.
const isoDateSchema = isoBirthDateSchema;

const coveredMemberSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'اسم العضو مطلوب')
      .max(200, 'اسم العضو لا يتعدى 200 حرف'),
    relationship: z
      .string()
      .trim()
      .min(1, 'صلة القرابة مطلوبة')
      .max(50, 'صلة القرابة لا تتعدى 50 حرف'),
    dob: isoDateSchema,
  })
  .strict();

export type CoveredMemberInput = z.infer<typeof coveredMemberSchema>;

export const subscribeShieldSchema = z
  .object({
    plan: z.enum(['individual', 'family', 'vip_family', 'diamond'], {
      errorMap: () => ({ message: 'خطة الاشتراك مطلوبة' }),
    }),
    owner_dob: isoDateSchema,
    covered_members: z
      .array(coveredMemberSchema)
      .max(20, 'لا يمكن إضافة أكثر من 20 عضو في القائمة الأولية')
      .optional()
      .default([]),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Uniqueness on (lower(BTRIM(name)), dob) — mirrors the
    // RPC-side check so the user sees a field-level error
    // before the round-trip.
    const seen = new Set<string>();
    for (let i = 0; i < val.covered_members.length; i++) {
      const m = val.covered_members[i]!;
      const key = `${m.name.trim().toLowerCase()}|${m.dob}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['covered_members', i, 'name'],
          message: 'اسم العضو + تاريخ الميلاد مكرر',
        });
      }
      seen.add(key);
    }
  });

export type SubscribeShieldInput = z.infer<typeof subscribeShieldSchema>;

export const activateSubscriptionSchema = z
  .object({
    subscription_id: z.string().uuid('معرّف الاشتراك غير صحيح'),
  })
  .strict();

export type ActivateSubscriptionInput = z.infer<
  typeof activateSubscriptionSchema
>;
