/**
 * Operator portal i18n dictionary (Phase 5.1).
 *
 * Single hand-rolled dictionary, no library, no DB. Used by the
 * operator-facing surface at `/operator/offer/[token]` and its
 * children. Keys are typed; missing translations fail the
 * `type-check` gate.
 *
 * Lang is read from the `?lang=` query parameter (no cookies, no
 * localStorage in v1). Default is Arabic; any value other than
 * `en` falls through to `ar`.
 */

import type { AircraftCategoryValue } from '@/lib/validators/promote-lead';
import { isIataFormat } from '@/lib/utils/iata';
import type { AirportRow } from '@/types/database';

export type Lang = 'ar' | 'en';

const dictionary = {
  // Layout chrome ----------------------------------------------------------
  portal_tagline: {
    ar: 'بوابة تقديم العروض للمشغّلين',
    en: 'Operator offer submission portal',
  },
  lang_toggle_to_en: { ar: 'EN', en: 'EN' },
  lang_toggle_to_ar: { ar: 'العربية', en: 'العربية' },

  // Trip summary (S1) ------------------------------------------------------
  trip_details: { ar: 'تفاصيل الرحلة', en: 'Trip Details' },
  route_label: { ar: 'المسار', en: 'Route' },
  departure_label: { ar: 'المغادرة', en: 'Departure' },
  return_label: { ar: 'العودة', en: 'Return' },
  passengers_label: { ar: 'عدد الركاب', en: 'Passengers' },
  aircraft_category_requested_label: {
    ar: 'فئة الطائرة المطلوبة',
    en: 'Requested aircraft category',
  },
  special_requests_label: { ar: 'متطلبات خاصة', en: 'Special requests' },
  riyadh_time_suffix: {
    ar: '(بتوقيت الرياض)',
    en: '(Riyadh time)',
  },
  link_valid_until_label: {
    ar: 'هذا الرابط صالح حتى',
    en: 'This link is valid until',
  },

  // ExpiredLink variants (S2) ---------------------------------------------
  expired_generic_title: {
    ar: 'هذا الرابط منتهي الصلاحية',
    en: 'This link is no longer valid',
  },
  expired_generic_body: {
    ar: 'الرابط الذي وصلك لم يعد صالحاً — ربما انتهت مدته أو تم استبداله برابط أحدث.',
    en: 'The link you received is no longer valid — it may have expired or been replaced by a newer one.',
  },
  expired_generic_subtext: {
    ar: 'للاستفسار، تواصل معنا مباشرة عبر واتساب.',
    en: 'For inquiries, contact us directly on WhatsApp.',
  },
  expired_link_expired_title: {
    ar: 'انتهت مدة صلاحية هذا الرابط',
    en: 'This link has expired',
  },
  expired_link_expired_body: {
    ar: 'تجاوز هذا الرابط مدته القصوى. يرجى التواصل مع المؤسس لطلب رابط جديد.',
    en: 'This link has passed its maximum validity period. Please contact the founder to request a new one.',
  },
  expired_link_cancelled_title: {
    ar: 'تم إلغاء هذه الدعوة',
    en: 'This invitation was cancelled',
  },
  expired_link_cancelled_body: {
    ar: 'تم إلغاء هذه الدعوة من قبل الإدارة (تم إرسال دعوة أحدث). يرجى استخدام الرابط الجديد إن وصلك.',
    en: 'This invitation was cancelled by Aeris (a newer invitation was sent). Please use the new link if you received one.',
  },
  expired_link_already_used_title: {
    ar: 'تم استخدام هذا الرابط',
    en: 'This link was already used',
  },
  expired_link_already_used_body: {
    ar: 'تم استخدام هذا الرابط مسبقاً — تم استلام عرضك. يرجى التواصل عبر واتساب لأي استفسار.',
    en: 'This link has already been used — your offer was received. Please reach out on WhatsApp with any questions.',
  },
  whatsapp_contact_button: {
    ar: 'تواصل عبر واتساب',
    en: 'Contact on WhatsApp',
  },

  // Offer form (S3, S4, S5) -----------------------------------------------
  submit_offer_heading: { ar: 'تقديم عرض', en: 'Submit Offer' },
  submit_offer_subtext: {
    ar: 'املأ بيانات العرض. سيتواصل معك المؤسس عبر واتساب لتأكيد القبول.',
    en: 'Fill in your offer details. The founder will reach out on WhatsApp to confirm acceptance.',
  },

  field_operator_name: {
    ar: 'اسم الشركة المشغّلة',
    en: 'Operator company name',
  },
  field_operator_phone: {
    ar: 'رقم واتساب المشغّل (E.164)',
    en: 'Operator WhatsApp number (E.164)',
  },
  field_operator_email: {
    ar: 'بريد إلكتروني (اختياري)',
    en: 'Email (optional)',
  },
  field_aircraft_category: {
    ar: 'فئة الطائرة',
    en: 'Aircraft category',
  },
  field_aircraft_type: { ar: 'نوع الطائرة', en: 'Aircraft type' },
  field_aircraft_registration: {
    ar: 'رقم تسجيل الطائرة (اختياري)',
    en: 'Aircraft registration (optional)',
  },
  field_total_price: {
    ar: 'السعر الإجمالي (ريال سعودي)',
    en: 'Total price (SAR)',
  },
  field_departure_eta: {
    ar: 'موعد الإقلاع المقترح',
    en: 'Proposed departure time',
  },
  field_validity_hours: {
    ar: 'مدة صلاحية العرض (ساعات)',
    en: 'Offer validity (hours)',
  },
  field_notes: { ar: 'ملاحظات (اختياري)', en: 'Notes (optional)' },
  select_choose_placeholder: { ar: '— اختر —', en: '— Select —' },
  submit_button: { ar: 'إرسال العرض', en: 'Submit offer' },

  helper_operator_name: {
    ar: 'اسم الشركة كما تريد ظهوره للمؤسس عند المقارنة.',
    en: 'Your company name as you want it shown to the founder during comparison.',
  },
  helper_operator_phone: {
    ar: 'الصيغة الدولية: +966XXXXXXXXX (مع رمز الدولة).',
    en: 'International format: +966XXXXXXXXX (with country code).',
  },
  helper_total_price: {
    ar: 'بالريال السعودي، الحد الأدنى 1000.',
    en: 'In Saudi Riyal, minimum 1000.',
  },
  helper_departure_eta: {
    ar: 'بتوقيت السعودية (Asia/Riyadh). الموعد المقترح في تفاصيل الرحلة أعلى الصفحة.',
    en: 'Saudi Arabia time (Asia/Riyadh). The requested departure is in the trip details above.',
  },
  helper_validity_hours: {
    ar: 'المدة التي يبقى فيها عرضك قابلاً للقبول من قبل المؤسس (الحد الأقصى 168 ساعة = 7 أيام).',
    en: 'How long your offer remains acceptable by the founder (maximum 168 hours = 7 days).',
  },

  // Success panel (S4) ----------------------------------------------------
  success_title: { ar: 'تم استلام عرضك', en: 'Your offer was received' },
  success_body: {
    ar: 'سيتواصل معك المؤسس عبر واتساب لتأكيد القبول خلال مدة صلاحية عرضك.',
    en: 'The founder will reach out on WhatsApp to confirm acceptance within your offer validity window.',
  },
  success_summary_heading: { ar: 'ملخص عرضك', en: 'Your offer summary' },
  success_field_request_number: {
    ar: 'رقم الطلب',
    en: 'Request number',
  },
  success_field_price: { ar: 'السعر الإجمالي', en: 'Total price' },
  success_field_aircraft: { ar: 'الطائرة', en: 'Aircraft' },
  success_field_departure: { ar: 'موعد الإقلاع', en: 'Departure ETA' },
  success_field_validity: { ar: 'مدة صلاحية العرض', en: 'Offer validity' },
  success_validity_hours_unit: { ar: 'ساعة', en: 'hours' },
  success_save_reference_note: {
    ar: 'احفظ هذه الصفحة كمرجع — لن تظهر مرة أخرى عند التحديث.',
    en: 'Save this page for reference — it will not reappear if you refresh.',
  },
  sar_unit: { ar: 'ريال', en: 'SAR' },

  // Error messages (block-level fallback) ---------------------------------
  error_invalid_input_block: {
    ar: 'البيانات غير مكتملة أو غير صحيحة. راجع الحقول المُعلَّمة.',
    en: 'Some fields are incomplete or invalid. Review the highlighted fields.',
  },
  error_target_not_pending: {
    ar: 'هذا الرابط لم يعد قابلاً للاستخدام (تم استخدامه مسبقاً أو ألغاه المؤسس).',
    en: 'This link is no longer usable (it was used previously or cancelled by the founder).',
  },
  error_trip_not_open: {
    ar: 'هذه الرحلة لم تعد قابلة للحجز (محجوزة أو ملغاة).',
    en: 'This trip is no longer bookable (already booked or cancelled).',
  },
  error_token_invalid_or_stale: {
    ar: 'هذا الرابط لم يعد صالحاً. يرجى طلب رابط جديد من المؤسس.',
    en: 'This link is no longer valid. Please request a new one from the founder.',
  },
  error_failed: {
    ar: 'تعذّر إرسال العرض الآن. حاول مرة أخرى.',
    en: 'Could not submit the offer right now. Please try again.',
  },

  // Per-field error messages (Zod codes → human strings) ------------------
  zod_operator_name_required: {
    ar: 'يرجى كتابة اسم الشركة (حرفين على الأقل).',
    en: 'Please enter the company name (at least two characters).',
  },
  zod_operator_name_too_long: {
    ar: 'الاسم طويل جداً (الحد الأقصى 120 حرفاً).',
    en: 'Name is too long (maximum 120 characters).',
  },
  zod_operator_phone_invalid: {
    ar: 'صيغة الرقم غير صحيحة. استخدم +966XXXXXXXXX.',
    en: 'Invalid phone format. Use +966XXXXXXXXX.',
  },
  zod_operator_email_too_long: {
    ar: 'البريد طويل جداً (الحد الأقصى 120 حرفاً).',
    en: 'Email is too long (maximum 120 characters).',
  },
  zod_operator_email_invalid: {
    ar: 'صيغة البريد غير صحيحة.',
    en: 'Invalid email format.',
  },
  zod_aircraft_category_invalid: {
    ar: 'فئة الطائرة المختارة غير معروفة.',
    en: 'Unknown aircraft category selected.',
  },
  zod_aircraft_type_too_long: {
    ar: 'نوع الطائرة طويل جداً (الحد الأقصى 80 حرفاً).',
    en: 'Aircraft type is too long (maximum 80 characters).',
  },
  zod_aircraft_registration_too_long: {
    ar: 'رقم التسجيل طويل جداً (الحد الأقصى 20 حرفاً).',
    en: 'Registration is too long (maximum 20 characters).',
  },
  zod_total_price_required: {
    ar: 'يرجى إدخال السعر الإجمالي.',
    en: 'Please enter the total price.',
  },
  zod_total_price_invalid: {
    ar: 'السعر يجب أن يكون رقماً صحيحاً.',
    en: 'Price must be a valid number.',
  },
  zod_total_price_too_low: {
    ar: 'الحد الأدنى للسعر 1000 ريال.',
    en: 'Minimum price is 1000 SAR.',
  },
  zod_total_price_too_high: {
    ar: 'السعر يتجاوز الحد المسموح.',
    en: 'Price exceeds the allowed maximum.',
  },
  zod_departure_eta_required: {
    ar: 'يرجى اختيار موعد الإقلاع.',
    en: 'Please select a departure time.',
  },
  zod_departure_eta_invalid: {
    ar: 'موعد الإقلاع المختار غير صحيح.',
    en: 'Selected departure time is invalid.',
  },
  zod_validity_hours_invalid: {
    ar: 'مدة صلاحية العرض يجب أن تكون عدداً صحيحاً.',
    en: 'Offer validity must be a whole number.',
  },
  zod_validity_hours_too_low: {
    ar: 'الحد الأدنى لمدة الصلاحية ساعة واحدة.',
    en: 'Minimum offer validity is 1 hour.',
  },
  zod_validity_hours_too_high: {
    ar: 'الحد الأقصى لمدة الصلاحية 168 ساعة (7 أيام).',
    en: 'Maximum offer validity is 168 hours (7 days).',
  },
  zod_notes_too_long: {
    ar: 'الملاحظات طويلة جداً (الحد الأقصى 2000 حرف).',
    en: 'Notes are too long (maximum 2000 characters).',
  },

  // Aircraft category labels (used in form select + trip summary) ---------
  aircraft_category_light: { ar: 'خفيفة', en: 'Light' },
  aircraft_category_mid: { ar: 'متوسطة', en: 'Midsize' },
  aircraft_category_super_mid: { ar: 'متوسطة فاخرة', en: 'Super-midsize' },
  aircraft_category_heavy: { ar: 'كبيرة', en: 'Heavy' },
  aircraft_category_long_range: {
    ar: 'بعيدة المدى',
    en: 'Long-range',
  },

  // Phase 6.0 PR 2 (S6) — airport label fallbacks for the
  // operator portal trip summary.
  airport_unknown_suffix: {
    ar: '(غير معروف)',
    en: '(unknown)',
  },
  airport_missing_value: {
    ar: '—',
    en: '—',
  },

  // Phase 6.1 PR 1 — operator portal preferences section
  // labels. Dormant in PR 1 (no consumer); PR 2's
  // operator-portal display will start reading them.
  // Additive only, no restructuring of the existing
  // dictionary entries.
  preferences_section_title: {
    ar: 'تفضيلات العميل',
    en: 'Customer Preferences',
  },
  pref_halal_required: {
    ar: 'حلال: نعم — وجبات حلال مطلوبة',
    en: 'Halal meals: required',
  },
  pref_halal_no: {
    ar: 'حلال: لا حاجة',
    en: 'Halal meals: not required',
  },
  pref_prayer_setup: {
    ar: 'تجهيز الصلاة: مطلوب',
    en: 'Prayer setup: requested',
  },
  pref_prayer_setup_no: {
    ar: 'تجهيز الصلاة: غير مطلوب',
    en: 'Prayer setup: not required',
  },
  pref_crew_gender_male: {
    ar: 'جنس الطاقم المفضّل: ذكر',
    en: 'Preferred crew gender: male',
  },
  pref_crew_gender_female: {
    ar: 'جنس الطاقم المفضّل: أنثى',
    en: 'Preferred crew gender: female',
  },
  pref_crew_gender_no_preference: {
    ar: 'جنس الطاقم المفضّل: لا تفضيل',
    en: 'Preferred crew gender: no preference',
  },
  pref_pilot_nationality_label: {
    ar: 'جنسية الطيار المفضّلة',
    en: 'Preferred pilot nationality',
  },
  pref_crew_nationalities_label: {
    ar: 'جنسيات الطاقم المفضّلة',
    en: 'Preferred crew nationalities',
  },
  pref_crew_languages_label: {
    ar: 'لغات الطاقم المفضّلة',
    en: 'Preferred crew languages',
  },
  pref_child_seats_label: {
    ar: 'كراسي أطفال',
    en: 'Child seats',
  },
  pref_elderly_assistance: {
    ar: 'مساعدة لكبار السن: مطلوبة',
    en: 'Elderly assistance: requested',
  },
  pref_elderly_assistance_no: {
    ar: 'مساعدة لكبار السن: غير مطلوبة',
    en: 'Elderly assistance: not required',
  },
  pref_medical_notes_label: {
    ar: 'ملاحظات طبية',
    en: 'Medical notes',
  },
} as const satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof dictionary;

export function t(key: StringKey, lang: Lang): string {
  return dictionary[key][lang];
}

/**
 * Read the `lang` query-param value (string, string[], or
 * undefined) and clamp to a known Lang. Anything other than
 * `en` falls through to `ar`. Per acceptance #14.
 */
export function parseLang(value: string | string[] | null | undefined): Lang {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'en' ? 'en' : 'ar';
}

/**
 * Map an aircraft category enum value to its translated label.
 * Used by both the trip summary (S1) and the form's category
 * select (S5). Falls back to the enum value itself if a future
 * category is added without a matching translation key — that
 * makes the type-check the gate, not a runtime crash.
 */
export function aircraftCategoryLabel(
  cat: AircraftCategoryValue,
  lang: Lang
): string {
  const key = `aircraft_category_${cat}` as StringKey;
  return t(key, lang);
}

/**
 * Format an ISO timestamp in Asia/Riyadh time, in the active
 * language's locale. Phase 5.1 spec acceptance #1: single
 * canonical Asia/Riyadh time (no dual-time, no operator-local).
 *
 * Example: "06/05/2026 15:30 (بتوقيت الرياض)" or
 *          "06/05/2026 15:30 (Riyadh time)".
 */
export function formatRiyadhDateTime(
  value: string | Date | null | undefined,
  lang: Lang
): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '—';

  const formatted = new Intl.DateTimeFormat(
    lang === 'en' ? 'en-GB' : 'ar-SA',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Riyadh',
      numberingSystem: 'latn',
      calendar: 'gregory',
    }
  ).format(date);

  return `${formatted} ${t('riyadh_time_suffix', lang)}`;
}

/**
 * Format an ISO timestamp as a date-only label in Asia/Riyadh,
 * for fields like trip departure date (no time-of-day on the
 * trip-level row). Used by the trip summary's per-leg display.
 */
export function formatRiyadhDate(
  value: string | Date | null | undefined,
  lang: Lang
): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '—';

  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Riyadh',
    numberingSystem: 'latn',
    calendar: 'gregory',
  }).format(date);
}

// ============================================================================
// Phase 6.0 PR 2 (S6) — operator portal airport label helper
// ============================================================================

/**
 * Render the visible label for one side of a leg
 * (`leg.from` / `leg.to`) for the operator-portal trip
 * summary. Phase 6.0 spec S6 — handles three leg shapes to
 * maintain backwards compatibility with every trip already
 * in the database:
 *
 *   (a) New shape, IATA known.
 *       `value = "RUH"`, `freeform = null` (or undefined).
 *       Looks up the code in the airports list and renders
 *       `city_ar (IATA)` (or `city (IATA)` under `?lang=en`).
 *       If the lookup misses despite a valid IATA shape (the
 *       airport row was deleted between dispatch and view),
 *       renders the IATA bare with the `airport_unknown_suffix`.
 *
 *   (b) New shape, freeform fallback.
 *       `value = null`, `freeform = "العُلا — مطار خاص"`.
 *       Renders the freeform string verbatim. No DB lookup.
 *
 *   (c) Legacy shape, raw string.
 *       `value = "الرياض"`, `freeform = undefined`.
 *       The legs[] JSONB on this row was written before
 *       Phase 6.0 — `from` / `to` carry bare freeform Arabic
 *       strings and the `_freeform` keys don't exist. The
 *       discriminator is `freeform === undefined && value
 *       is not in IATA shape`. **Crucially the helper does
 *       NOT call getAirportByCode on legacy values** —
 *       treating them as IATA codes would produce a bogus
 *       lookup and a misleading `(unknown)` suffix.
 *
 * The security note from the Phase 5 activation entry's
 * Step 34 doesn't apply here (this helper runs after the
 * trip summary's own visibility check), so the three shapes
 * can be distinguished freely without leaking an oracle.
 */
export function airportLabel(
  value: string | null | undefined,
  freeform: string | null | undefined,
  lang: Lang,
  airports: AirportRow[]
): string {
  // Shape (b): explicit freeform fallback wins over anything
  // else. Freeform is set only when the new shape was used and
  // the picker chose freeform mode.
  if (freeform !== null && freeform !== undefined && freeform.length > 0) {
    return freeform;
  }

  // Shape (a) discriminator: IATA-shape value present.
  if (value && isIataFormat(value)) {
    const found = airports.find((a) => a.iata_code === value);
    if (found) {
      const city = lang === 'en' ? found.city : found.city_ar ?? found.city;
      return `${city} (${found.iata_code})`;
    }
    // Valid IATA shape but not in the picker's list — render
    // bare with the unknown suffix.
    return `${value} ${t('airport_unknown_suffix', lang)}`;
  }

  // Shape (c): legacy raw-string value (or any other non-IATA
  // string). Render verbatim, no lookup.
  if (value && value.length > 0) {
    return value;
  }

  // Truly missing (null/empty on both sides). Should not
  // happen for trips that the operator-portal page already
  // accepted, but guard anyway.
  return t('airport_missing_value', lang);
}
