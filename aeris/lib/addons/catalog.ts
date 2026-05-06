/**
 * Phase 6.2: priced add-ons catalog.
 *
 * Single TS source of truth for the 20 advisor-prescribed
 * add-ons (3 ground transfer + 2 crew + 3 catering + 12
 * special services). Source: advisor doc generate.js:469-503
 * + the 12 special services table; mid-prices rounded to the
 * nearest 50 SAR.
 *
 * This catalog is mirrored row-for-row by the SQL seed at
 * `aeris/supabase/migrations/20260508000009_phase_6_2_addon_catalog.sql`
 * (PR 1 File C). Parity is enforced by:
 *
 *   1. CI Layer 1 — `__tests__/catalog-vs-seed.test.ts`
 *      static-parses the seed SQL file and asserts deep-
 *      equality with `ADDONS_CATALOG` sorted by subtype.
 *      No DB connection. Runs on every PR.
 *
 *   2. Founder Probe 2b (Layer 2) — manual SELECT against
 *      production Supabase post-deploy + diff against this
 *      module.
 *
 * PR 2a's `attach_booking_addon` SQL function reads pricing,
 * per_passenger flag, allow_quantity flag, commission rate,
 * and free flag from the seeded `addon_catalog` table — NOT
 * from this TS module. The TS module is only consumed by
 * client-side code (admin attach UI suggestions, etc.) and
 * by the parity test.
 *
 * Add-ons cannot be attached / mutated until PR 2a (DB
 * functions) and PR 2b (admin + customer UI) ship. PR 1
 * exports the catalog but no runtime page consumes it yet.
 */

export type AddonType = 'ground_transfer' | 'crew' | 'catering' | 'special';

export type AddonStatus = 'pending' | 'confirmed' | 'delivered' | 'cancelled';

export type AddonSuggestionKey =
  | 'halal'
  | 'prayer_setup'
  | 'elderly_assistance'
  | 'child_seats'
  | 'medical_notes'
  | 'crew_languages'
  | 'crew_nationalities'
  | 'pilot_nationality';

export type AddonCatalogEntry = {
  /**
   * Stable identifier. The (type, subtype) pair is the
   * catalog primary key. addon_type lands on
   * booking_addons.addon_type (ENUM). subtype lands on
   * booking_addons.addon_subtype (VARCHAR(100)) and is
   * pinned by the booking_addons_subtype_check CHECK
   * constraint AND by the addon_catalog.subtype PK.
   */
  type: AddonType;
  subtype: string;
  label_ar: string;
  label_en: string;
  description_ar: string;
  description_en: string;
  /**
   * Mid-range price the catalog defaults to. Pulled from
   * the advisor doc and rounded to the nearest 50 SAR.
   */
  unit_price_sar: number;
  unit_price_min_sar: number;
  unit_price_max_sar: number;
  /**
   * Whether the price is per-passenger (vs per-add-on).
   * Currently only catering rows (standard_free,
   * arabic_premium, royal_dining) are per-passenger.
   * `attach_booking_addon` overrides any caller-supplied
   * quantity for per_passenger subtypes and forces
   * `quantity = bookings.passengers_count_snapshot`.
   */
  per_passenger: boolean;
  /**
   * Platform margin (advisor's 15-30%). Stored as integer
   * percentage (25 = 25%). Lands on
   * booking_addons.commission_rate as DECIMAL(4,2).
   */
  commission_rate_pct: number;
  /**
   * Whether this add-on can have quantity > 1. Most rows
   * are quantity = 1 only (single limousine, single
   * hostess). Per-passenger rows compute quantity from
   * the trip's passengers_count automatically; their
   * `allow_quantity` is irrelevant at attach time.
   */
  allow_quantity: boolean;
  /**
   * Soft-suggestion keys. The admin attach UI matches
   * these against `trip_requests.preferences` from
   * Phase 6.1: `halal: true` highlights catering rows
   * tagged `halal`; `prayer_setup: true` highlights
   * `prayer_kit`; `child_seats: 2` highlights
   * `child_accessories`. Non-blocking — the founder can
   * attach anything.
   */
  suggested_for: ReadonlyArray<AddonSuggestionKey>;
  /**
   * Whether the entry is FREE. Free entries (Standard
   * catering, prayer kit) still create booking_addons
   * rows for tracking, but with unit_price = 0. The
   * `attach_booking_addon` SQL function rejects any
   * unit_price_override != 0 on free rows with
   * `price_override_on_free_addon`.
   */
  free: boolean;
  /**
   * Optional advisor-doc reference for traceability.
   */
  advisor_ref?: string;
};

// ============================================================================
// 20-row catalog. Order matters for the parity test (sorted
// by subtype alphabetically before deep-equal).
// ============================================================================

export const ADDONS_CATALOG: ReadonlyArray<AddonCatalogEntry> = [
  // Ground transfer (3)
  {
    type: 'ground_transfer',
    subtype: 'limousine_executive',
    label_ar: 'ليموزين Executive',
    label_en: 'Executive Limousine',
    description_ar: 'سيارة E-Class أو BMW 5 — مناسبة للنقل اليومي.',
    description_en: 'E-Class or BMW 5 — suitable for daily transfers.',
    unit_price_sar: 550,
    unit_price_min_sar: 400,
    unit_price_max_sar: 700,
    per_passenger: false,
    commission_rate_pct: 20,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 limousine_executive',
  },
  {
    type: 'ground_transfer',
    subtype: 'limousine_business',
    label_ar: 'ليموزين Business',
    label_en: 'Business Limousine',
    description_ar: 'سيارة S-Class أو BMW 7 — للرحلات التنفيذية.',
    description_en: 'S-Class or BMW 7 — for executive trips.',
    unit_price_sar: 1200,
    unit_price_min_sar: 900,
    unit_price_max_sar: 1500,
    per_passenger: false,
    commission_rate_pct: 22,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 limousine_business',
  },
  {
    type: 'ground_transfer',
    subtype: 'limousine_luxury',
    label_ar: 'ليموزين Luxury',
    label_en: 'Luxury Limousine',
    description_ar: 'سيارة Rolls-Royce أو Bentley — أعلى مستوى من الفخامة.',
    description_en: 'Rolls-Royce or Bentley — top-tier luxury.',
    unit_price_sar: 3750,
    unit_price_min_sar: 2500,
    unit_price_max_sar: 5000,
    per_passenger: false,
    commission_rate_pct: 25,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 limousine_luxury',
  },

  // Crew (2)
  {
    type: 'crew',
    subtype: 'hostess_custom',
    label_ar: 'تخصيص مضيفة',
    label_en: 'Custom Hostess',
    description_ar: 'مضيفة مخصصة بالجنسية أو اللغة أو الاختصاص المطلوب.',
    description_en: 'Hostess customized by nationality, language, or specialty.',
    unit_price_sar: 5000,
    unit_price_min_sar: 2000,
    unit_price_max_sar: 8000,
    per_passenger: false,
    commission_rate_pct: 17,
    allow_quantity: false,
    suggested_for: ['crew_languages', 'crew_nationalities'],
    free: false,
    advisor_ref: 'advisor:5.1 hostess_custom',
  },
  {
    type: 'crew',
    subtype: 'pilot_custom',
    label_ar: 'تخصيص طيار',
    label_en: 'Custom Pilot',
    description_ar: 'طيار مخصص بالجنسية أو الخبرة أو أسلوب القيادة.',
    description_en: 'Pilot customized by nationality, experience, or flying style.',
    unit_price_sar: 1500,
    unit_price_min_sar: 500,
    unit_price_max_sar: 2500,
    per_passenger: false,
    commission_rate_pct: 13,
    allow_quantity: false,
    suggested_for: ['pilot_nationality'],
    free: false,
    advisor_ref: 'advisor:5.1 pilot_custom',
  },

  // Catering (3, all per_passenger)
  {
    type: 'catering',
    subtype: 'standard_free',
    label_ar: 'وجبات Standard',
    label_en: 'Standard Catering',
    description_ar: 'قهوة ومعجنات — مجاني ضمن أي رحلة.',
    description_en: 'Coffee and pastries — complimentary on every flight.',
    unit_price_sar: 0,
    unit_price_min_sar: 0,
    unit_price_max_sar: 0,
    per_passenger: true,
    commission_rate_pct: 0,
    allow_quantity: false,
    suggested_for: [],
    free: true,
    advisor_ref: 'advisor:5.1 standard_free',
  },
  {
    type: 'catering',
    subtype: 'arabic_premium',
    label_ar: 'وجبات Arabic Premium',
    label_en: 'Arabic Premium Catering',
    description_ar: 'قهوة عربية ووجبة كاملة — مناسبة للضيوف الكرام.',
    description_en: 'Arabic coffee and a full meal — suitable for VIP guests.',
    unit_price_sar: 550,
    unit_price_min_sar: 400,
    unit_price_max_sar: 700,
    per_passenger: true,
    commission_rate_pct: 15,
    allow_quantity: false,
    suggested_for: ['halal'],
    free: false,
    advisor_ref: 'advisor:5.1 arabic_premium',
  },
  {
    type: 'catering',
    subtype: 'royal_dining',
    label_ar: 'Royal Dining',
    label_en: 'Royal Dining',
    description_ar: 'وجبات على مستوى مطاعم Zuma وNobu وHakkasan.',
    description_en: 'Fine dining at the level of Zuma, Nobu, or Hakkasan.',
    unit_price_sar: 2500,
    unit_price_min_sar: 1500,
    unit_price_max_sar: 3500,
    per_passenger: true,
    commission_rate_pct: 25,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 royal_dining',
  },

  // Special services (12)
  {
    type: 'special',
    subtype: 'floral_arrangement',
    label_ar: 'تنسيق ورود',
    label_en: 'Floral Arrangement',
    description_ar: 'تنسيق ورود طبيعية على متن الطائرة.',
    description_en: 'Fresh floral arrangement on board.',
    unit_price_sar: 1000,
    unit_price_min_sar: 500,
    unit_price_max_sar: 1500,
    per_passenger: false,
    commission_rate_pct: 30,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 floral_arrangement',
  },
  {
    type: 'special',
    subtype: 'celebration',
    label_ar: 'احتفال خاص',
    label_en: 'Celebration Package',
    description_ar: 'كيك وهدايا واحتفال داخل الطائرة.',
    description_en: 'Cake, gifts, and an in-flight celebration setup.',
    unit_price_sar: 4000,
    unit_price_min_sar: 2000,
    unit_price_max_sar: 6000,
    per_passenger: false,
    commission_rate_pct: 25,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 celebration',
  },
  {
    type: 'special',
    subtype: 'photographer',
    label_ar: 'مصور رحلات',
    label_en: 'Onboard Photographer',
    description_ar: 'مصور محترف لتوثيق الرحلة.',
    description_en: 'Professional photographer to document the trip.',
    unit_price_sar: 5500,
    unit_price_min_sar: 3000,
    unit_price_max_sar: 8000,
    per_passenger: false,
    commission_rate_pct: 20,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 photographer',
  },
  {
    type: 'special',
    subtype: 'masseur',
    label_ar: 'مدلك على متن الطائرة',
    label_en: 'Onboard Masseur',
    description_ar: 'مدلك أو مدلكة محترف(ة) خلال الرحلة.',
    description_en: 'Professional masseur during the flight.',
    unit_price_sar: 3750,
    unit_price_min_sar: 2500,
    unit_price_max_sar: 5000,
    per_passenger: false,
    commission_rate_pct: 18,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 masseur',
  },
  {
    type: 'special',
    subtype: 'prayer_kit',
    label_ar: 'سجادة صلاة وتجهيز ديني',
    label_en: 'Prayer Kit',
    description_ar: 'سجادة صلاة ومستلزمات دينية — مجاني.',
    description_en: 'Prayer mat and religious essentials — complimentary.',
    unit_price_sar: 0,
    unit_price_min_sar: 0,
    unit_price_max_sar: 0,
    per_passenger: false,
    commission_rate_pct: 0,
    allow_quantity: false,
    suggested_for: ['prayer_setup'],
    free: true,
    advisor_ref: 'advisor:5.1 prayer_kit',
  },
  {
    type: 'special',
    subtype: 'child_accessories',
    label_ar: 'تجهيز كامل للأطفال',
    label_en: 'Child Accessories',
    description_ar: 'مستلزمات الأطفال (مقاعد، طعام، ألعاب).',
    description_en: 'Child essentials (seats, meals, toys).',
    unit_price_sar: 1150,
    unit_price_min_sar: 800,
    unit_price_max_sar: 1500,
    per_passenger: false,
    commission_rate_pct: 25,
    allow_quantity: false,
    suggested_for: ['child_seats'],
    free: false,
    advisor_ref: 'advisor:5.1 child_accessories',
  },
  {
    type: 'special',
    subtype: 'pet_transport',
    label_ar: 'نقل حيوانات أليفة',
    label_en: 'Pet Transport',
    description_ar: 'تجهيزات نقل حيوان أليف على متن الطائرة.',
    description_en: 'On-board pet transport setup.',
    unit_price_sar: 2000,
    unit_price_min_sar: 1000,
    unit_price_max_sar: 3000,
    per_passenger: false,
    commission_rate_pct: 30,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 pet_transport',
  },
  {
    type: 'special',
    subtype: 'onboard_doctor',
    label_ar: 'طبيب مرافق',
    label_en: 'Onboard Doctor',
    description_ar: 'طبيب أو طبيبة لمرافقة الرحلة الطبية.',
    description_en: 'Doctor escorting the flight (medical support).',
    unit_price_sar: 14000,
    unit_price_min_sar: 8000,
    unit_price_max_sar: 20000,
    per_passenger: false,
    commission_rate_pct: 15,
    allow_quantity: false,
    suggested_for: ['medical_notes', 'elderly_assistance'],
    free: false,
    advisor_ref: 'advisor:5.1 onboard_doctor',
  },
  {
    type: 'special',
    subtype: 'vip_security',
    label_ar: 'حراسة شخصية VIP',
    label_en: 'VIP Personal Security',
    description_ar: 'حراسة شخصية مدربة لكبار الشخصيات.',
    description_en: 'Trained personal security for VIPs.',
    unit_price_sar: 6500,
    unit_price_min_sar: 3000,
    unit_price_max_sar: 10000,
    per_passenger: false,
    commission_rate_pct: 20,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 vip_security',
  },
  {
    type: 'special',
    subtype: 'live_music',
    label_ar: 'موسيقى حية',
    label_en: 'Live Music',
    description_ar: 'عازف موسيقى حية على متن الطائرة.',
    description_en: 'Live musician performing on board.',
    unit_price_sar: 10000,
    unit_price_min_sar: 5000,
    unit_price_max_sar: 15000,
    per_passenger: false,
    commission_rate_pct: 22,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 live_music',
  },
  {
    type: 'special',
    subtype: 'airport_vip',
    label_ar: 'تخليص VIP بالمطار',
    label_en: 'Airport VIP Clearance',
    description_ar: 'تخليص جوازات وأمتعة بمسار VIP داخل المطار.',
    description_en: 'VIP fast-track passport and baggage clearance at the airport.',
    unit_price_sar: 1000,
    unit_price_min_sar: 500,
    unit_price_max_sar: 1500,
    per_passenger: false,
    commission_rate_pct: 40,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 airport_vip',
  },
  {
    type: 'special',
    subtype: 'diplomatic_protocol',
    label_ar: 'بروتوكول دبلوماسي',
    label_en: 'Diplomatic Protocol',
    description_ar: 'استقبال دبلوماسي رسمي عند الوصول والمغادرة.',
    description_en: 'Formal diplomatic reception on arrival and departure.',
    unit_price_sar: 3500,
    unit_price_min_sar: 2000,
    unit_price_max_sar: 5000,
    per_passenger: false,
    commission_rate_pct: 25,
    allow_quantity: false,
    suggested_for: [],
    free: false,
    advisor_ref: 'advisor:5.1 diplomatic_protocol',
  },
];

// ============================================================================
// Lookups (built once at module load).
// ============================================================================

/**
 * Subtype → entry. Used by:
 *   - `adminAttachAddonSchema` Zod refine (subtype existence
 *     check at the validator layer, defense in depth before
 *     the SQL function's `addon_catalog` lookup).
 *   - Admin attach UI (price + label rendering).
 */
export const ADDONS_BY_SUBTYPE: ReadonlyMap<string, AddonCatalogEntry> =
  new Map(ADDONS_CATALOG.map((entry) => [entry.subtype, entry]));

/**
 * Type → entries. Used by the admin attach UI to group rows
 * by category (Ground Transfer / Crew / Catering / Special).
 */
export const ADDONS_BY_TYPE: ReadonlyMap<AddonType, ReadonlyArray<AddonCatalogEntry>> =
  (() => {
    const grouped = new Map<AddonType, AddonCatalogEntry[]>();
    for (const entry of ADDONS_CATALOG) {
      const list = grouped.get(entry.type) ?? [];
      list.push(entry);
      grouped.set(entry.type, list);
    }
    return grouped;
  })();

/**
 * Const ReadonlyArray of all 20 subtypes for runtime
 * validation. The SQL `booking_addons_subtype_check`
 * constraint pins the same list at the DB layer; the
 * `catalog-vs-seed.test.ts` parity test asserts the two
 * sources match.
 */
export const KNOWN_ADDON_SUBTYPES: ReadonlyArray<string> = ADDONS_CATALOG.map(
  (entry) => entry.subtype
);
