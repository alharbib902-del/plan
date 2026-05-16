import { z } from 'zod';

/**
 * Phase 12 PR 1 — Zod schemas for the medevac intake RPCs.
 *
 * Two surfaces:
 *   - medevacRequestPublicSchema: §4.1 create_medevac_request_guest
 *     (full payload from /medevac public form + customer fields;
 *     enforces severity='stable' per D1)
 *   - medevacRequestAuthedSchema: §4.2
 *     create_medevac_request_authenticated (same shape minus
 *     customer fields — sourced from clients table via session)
 *
 * Whitespace handling: every string field — required AND
 * optional — is `.trim()`-ed at the Zod boundary so a payload
 * like "   " fails `.min(1)` (required) or arrives as "" (optional,
 * which the DB then converts to NULL via NULLIF(BTRIM(...), '')).
 *
 * Width limits mirror §3.1:
 *   - patient_name: max 200
 *   - contact_name: max 120
 *   - contact_phone: max 20
 *   - contact_email: max 120
 *   - from_location_freeform / to_hospital_name: max 300
 *   - from_iata / to_iata: max 4
 *
 * Severity gate (D1): publicSchema rejects moderate/critical
 * at the Zod boundary; the DB RPC also returns
 * `severity_requires_account` as defense-in-depth.
 */

// ============================================================
// Shared field schemas
// ============================================================

const severityPublicSchema = z.literal('stable', {
  errorMap: () => ({
    message: 'الحالات الحرجة والمتوسطة تتطلب حساب عميل (سجّل أولاً)',
  }),
});

const severityAuthedSchema = z.enum(['stable', 'moderate', 'critical'], {
  errorMap: () => ({ message: 'درجة الحالة مطلوبة' }),
});

const serviceLevelSchema = z.enum(
  ['BMT', 'ALS', 'CCT', 'repatriation'],
  { errorMap: () => ({ message: 'مستوى الخدمة الطبية مطلوب' }) }
);

const patientFieldsSchema = z.object({
  patient_name: z
    .string()
    .trim()
    .min(1, 'اسم المريض مطلوب')
    .max(200, 'اسم المريض لا يتعدى 200 حرف'),
  patient_age: z
    .number()
    .int('عمر المريض يجب أن يكون رقماً صحيحاً')
    .min(0, 'عمر المريض غير صالح')
    .max(130, 'عمر المريض غير صالح')
    .optional()
    .nullable(),
});

const contactFieldsSchema = z.object({
  contact_name: z
    .string()
    .trim()
    .min(1, 'اسم جهة الاتصال مطلوب')
    .max(120, 'اسم جهة الاتصال لا يتعدى 120 حرف'),
  contact_phone: z
    .string()
    .trim()
    .min(1, 'رقم الهاتف مطلوب')
    .max(20, 'رقم الهاتف لا يتعدى 20 حرف'),
  contact_email: z
    .string()
    .trim()
    .email('بريد إلكتروني غير صحيح')
    .max(120, 'البريد الإلكتروني لا يتعدى 120 حرف')
    .optional()
    .nullable(),
});

const routeFieldsSchema = z.object({
  from_location_freeform: z
    .string()
    .trim()
    .min(1, 'مكان الانطلاق مطلوب')
    .max(300, 'مكان الانطلاق لا يتعدى 300 حرف'),
  from_iata: z
    .string()
    .trim()
    .max(4, 'رمز IATA لا يتعدى 4 أحرف')
    .optional()
    .nullable(),
  to_hospital_name: z
    .string()
    .trim()
    .min(1, 'اسم المستشفى مطلوب')
    .max(300, 'اسم المستشفى لا يتعدى 300 حرف'),
  to_hospital_contact_phone: z
    .string()
    .trim()
    .max(20, 'رقم هاتف المستشفى لا يتعدى 20 حرف')
    .optional()
    .nullable(),
  to_hospital_freeform_address: z
    .string()
    .trim()
    .max(300, 'عنوان المستشفى لا يتعدى 300 حرف')
    .optional()
    .nullable(),
  to_iata: z
    .string()
    .trim()
    .max(4, 'رمز IATA لا يتعدى 4 أحرف')
    .optional()
    .nullable(),
});

const insuranceFieldsSchema = z.object({
  insurance_provider: z
    .string()
    .trim()
    .max(200, 'اسم شركة التأمين لا يتعدى 200 حرف')
    .optional()
    .nullable(),
  insurance_claim_ref: z
    .string()
    .trim()
    .max(100, 'مرجع المطالبة لا يتعدى 100 حرف')
    .optional()
    .nullable(),
});

const pricingFieldsSchema = z.object({
  estimated_value_sar: z
    .number()
    .positive('القيمة التقديرية يجب أن تكون موجبة'),
});

// ============================================================
// Public schema (§4.1) — severity='stable' enforced
// ============================================================

export const medevacRequestPublicSchema = patientFieldsSchema
  .merge(contactFieldsSchema)
  .merge(routeFieldsSchema)
  .merge(insuranceFieldsSchema)
  .merge(pricingFieldsSchema)
  .extend({
    condition_severity: severityPublicSchema,
    service_level: serviceLevelSchema,
  })
  .strict();

export type MedevacRequestPublicInput = z.infer<
  typeof medevacRequestPublicSchema
>;

// ============================================================
// Authed schema (§4.2) — all severities accepted
// ============================================================

export const medevacRequestAuthedSchema = patientFieldsSchema
  .merge(contactFieldsSchema)
  .merge(routeFieldsSchema)
  .merge(insuranceFieldsSchema)
  .merge(pricingFieldsSchema)
  .extend({
    condition_severity: severityAuthedSchema,
    service_level: serviceLevelSchema,
  })
  .strict();

export type MedevacRequestAuthedInput = z.infer<
  typeof medevacRequestAuthedSchema
>;
