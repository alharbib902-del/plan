-- ============================================================
-- Phase 6.2 — Priced Add-ons + Booking-shaped Checkout-prep
-- PR 1, File C: addon_catalog table + 20-row seed
-- ============================================================
--
-- Single SQL source of truth for catalog pricing,
-- per_passenger flag, allow_quantity flag, commission rate,
-- and free flag. PR 2a's RPCs (`attach_booking_addon`,
-- `update_booking_addon_quantity`) read from this table
-- instead of a hardcoded SQL CASE — Codex iteration-6 P2 #2
-- fix that eliminated the duplicate-source-of-truth risk
-- between TS catalog and SQL CASE.
--
-- Mirrors `aeris/lib/addons/catalog.ts` row-for-row. Parity
-- is enforced by:
--   - Layer 1: CI test
--     `lib/addons/__tests__/catalog-vs-seed.test.ts` parses
--     this file as plain text + asserts deep-equality with
--     `ADDONS_CATALOG`. No DB needed.
--   - Layer 2: founder Probe 2b runs
--     `SELECT * FROM addon_catalog ORDER BY subtype` on
--     production Supabase post-deploy + diffs against the
--     TS catalog snapshot.
--
-- Sequenced AFTER File A (which created the `addon_type`
-- ENUM the seed references). Runs in its own session.
--
-- Idempotent: re-runs use `INSERT ... ON CONFLICT (subtype)
-- DO UPDATE SET ...` so seed values can be tightened in
-- future spec iterations without dropping the table.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CREATE TABLE (idempotent).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addon_catalog (
  subtype              VARCHAR(100) PRIMARY KEY,
  addon_type           addon_type NOT NULL,
  label_ar             VARCHAR(200) NOT NULL,
  label_en             VARCHAR(200) NOT NULL,
  description_ar       TEXT NOT NULL,
  description_en       TEXT NOT NULL,
  unit_price_sar       DECIMAL(10,2) NOT NULL CHECK (unit_price_sar >= 0),
  unit_price_min_sar   DECIMAL(10,2) NOT NULL CHECK (unit_price_min_sar >= 0),
  unit_price_max_sar   DECIMAL(10,2) NOT NULL CHECK (unit_price_max_sar >= unit_price_min_sar),
  per_passenger        BOOLEAN NOT NULL DEFAULT false,
  commission_rate_pct  INTEGER NOT NULL CHECK (commission_rate_pct BETWEEN 0 AND 100),
  allow_quantity       BOOLEAN NOT NULL DEFAULT false,
  free                 BOOLEAN NOT NULL DEFAULT false,
  advisor_ref          TEXT
);

COMMENT ON TABLE addon_catalog IS
  'Phase 6.2: priced add-ons reference table. Single SQL source of truth for catalog pricing + per_passenger + allow_quantity + commission_rate + free flags. Mirrors lib/addons/catalog.ts row-for-row; parity enforced at CI by catalog-vs-seed.test.ts (Layer 1, no DB) and post-deploy by founder Probe 2b (Layer 2, DB-side).';

-- ------------------------------------------------------------
-- 2. RLS deny-all. Reads via service_role only (the
--    `attach_booking_addon` SQL function is SECURITY DEFINER
--    and runs with the function-owner role; it has implicit
--    access).
-- ------------------------------------------------------------
ALTER TABLE addon_catalog ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — anon + authenticated cannot
-- SELECT/INSERT/UPDATE/DELETE.

-- ------------------------------------------------------------
-- 3. 20-row seed via INSERT ... ON CONFLICT (subtype) DO
--    UPDATE SET ... so re-runs of this migration update the
--    rows in place rather than failing on PK collision.
--    Idempotent. Source: advisor doc generate.js:469-503 +
--    the 12 special services table; mid-prices rounded to
--    nearest 50 SAR.
-- ------------------------------------------------------------

-- Ground transfer (3 rows)
INSERT INTO addon_catalog (
  subtype, addon_type, label_ar, label_en,
  description_ar, description_en,
  unit_price_sar, unit_price_min_sar, unit_price_max_sar,
  per_passenger, commission_rate_pct, allow_quantity, free,
  advisor_ref
) VALUES
(
  'limousine_executive', 'ground_transfer',
  'ليموزين Executive', 'Executive Limousine',
  'سيارة E-Class أو BMW 5 — مناسبة للنقل اليومي.',
  'E-Class or BMW 5 — suitable for daily transfers.',
  550, 400, 700,
  false, 20, false, false,
  'advisor:5.1 limousine_executive'
),
(
  'limousine_business', 'ground_transfer',
  'ليموزين Business', 'Business Limousine',
  'سيارة S-Class أو BMW 7 — للرحلات التنفيذية.',
  'S-Class or BMW 7 — for executive trips.',
  1200, 900, 1500,
  false, 22, false, false,
  'advisor:5.1 limousine_business'
),
(
  'limousine_luxury', 'ground_transfer',
  'ليموزين Luxury', 'Luxury Limousine',
  'سيارة Rolls-Royce أو Bentley — أعلى مستوى من الفخامة.',
  'Rolls-Royce or Bentley — top-tier luxury.',
  3750, 2500, 5000,
  false, 25, false, false,
  'advisor:5.1 limousine_luxury'
)
ON CONFLICT (subtype) DO UPDATE SET
  addon_type = EXCLUDED.addon_type,
  label_ar = EXCLUDED.label_ar,
  label_en = EXCLUDED.label_en,
  description_ar = EXCLUDED.description_ar,
  description_en = EXCLUDED.description_en,
  unit_price_sar = EXCLUDED.unit_price_sar,
  unit_price_min_sar = EXCLUDED.unit_price_min_sar,
  unit_price_max_sar = EXCLUDED.unit_price_max_sar,
  per_passenger = EXCLUDED.per_passenger,
  commission_rate_pct = EXCLUDED.commission_rate_pct,
  allow_quantity = EXCLUDED.allow_quantity,
  free = EXCLUDED.free,
  advisor_ref = EXCLUDED.advisor_ref;

-- Crew (2 rows)
INSERT INTO addon_catalog (
  subtype, addon_type, label_ar, label_en,
  description_ar, description_en,
  unit_price_sar, unit_price_min_sar, unit_price_max_sar,
  per_passenger, commission_rate_pct, allow_quantity, free,
  advisor_ref
) VALUES
(
  'hostess_custom', 'crew',
  'تخصيص مضيفة', 'Custom Hostess',
  'مضيفة مخصصة بالجنسية أو اللغة أو الاختصاص المطلوب.',
  'Hostess customized by nationality, language, or specialty.',
  5000, 2000, 8000,
  false, 17, false, false,
  'advisor:5.1 hostess_custom'
),
(
  'pilot_custom', 'crew',
  'تخصيص طيار', 'Custom Pilot',
  'طيار مخصص بالجنسية أو الخبرة أو أسلوب القيادة.',
  'Pilot customized by nationality, experience, or flying style.',
  1500, 500, 2500,
  false, 13, false, false,
  'advisor:5.1 pilot_custom'
)
ON CONFLICT (subtype) DO UPDATE SET
  addon_type = EXCLUDED.addon_type,
  label_ar = EXCLUDED.label_ar,
  label_en = EXCLUDED.label_en,
  description_ar = EXCLUDED.description_ar,
  description_en = EXCLUDED.description_en,
  unit_price_sar = EXCLUDED.unit_price_sar,
  unit_price_min_sar = EXCLUDED.unit_price_min_sar,
  unit_price_max_sar = EXCLUDED.unit_price_max_sar,
  per_passenger = EXCLUDED.per_passenger,
  commission_rate_pct = EXCLUDED.commission_rate_pct,
  allow_quantity = EXCLUDED.allow_quantity,
  free = EXCLUDED.free,
  advisor_ref = EXCLUDED.advisor_ref;

-- Catering (3 rows; all per_passenger)
INSERT INTO addon_catalog (
  subtype, addon_type, label_ar, label_en,
  description_ar, description_en,
  unit_price_sar, unit_price_min_sar, unit_price_max_sar,
  per_passenger, commission_rate_pct, allow_quantity, free,
  advisor_ref
) VALUES
(
  'standard_free', 'catering',
  'وجبات Standard', 'Standard Catering',
  'قهوة ومعجنات — مجاني ضمن أي رحلة.',
  'Coffee and pastries — complimentary on every flight.',
  0, 0, 0,
  true, 0, false, true,
  'advisor:5.1 standard_free'
),
(
  'arabic_premium', 'catering',
  'وجبات Arabic Premium', 'Arabic Premium Catering',
  'قهوة عربية ووجبة كاملة — مناسبة للضيوف الكرام.',
  'Arabic coffee and a full meal — suitable for VIP guests.',
  550, 400, 700,
  true, 15, false, false,
  'advisor:5.1 arabic_premium'
),
(
  'royal_dining', 'catering',
  'Royal Dining', 'Royal Dining',
  'وجبات على مستوى مطاعم Zuma وNobu وHakkasan.',
  'Fine dining at the level of Zuma, Nobu, or Hakkasan.',
  2500, 1500, 3500,
  true, 25, false, false,
  'advisor:5.1 royal_dining'
)
ON CONFLICT (subtype) DO UPDATE SET
  addon_type = EXCLUDED.addon_type,
  label_ar = EXCLUDED.label_ar,
  label_en = EXCLUDED.label_en,
  description_ar = EXCLUDED.description_ar,
  description_en = EXCLUDED.description_en,
  unit_price_sar = EXCLUDED.unit_price_sar,
  unit_price_min_sar = EXCLUDED.unit_price_min_sar,
  unit_price_max_sar = EXCLUDED.unit_price_max_sar,
  per_passenger = EXCLUDED.per_passenger,
  commission_rate_pct = EXCLUDED.commission_rate_pct,
  allow_quantity = EXCLUDED.allow_quantity,
  free = EXCLUDED.free,
  advisor_ref = EXCLUDED.advisor_ref;

-- Special services (12 rows)
INSERT INTO addon_catalog (
  subtype, addon_type, label_ar, label_en,
  description_ar, description_en,
  unit_price_sar, unit_price_min_sar, unit_price_max_sar,
  per_passenger, commission_rate_pct, allow_quantity, free,
  advisor_ref
) VALUES
(
  'floral_arrangement', 'special',
  'تنسيق ورود', 'Floral Arrangement',
  'تنسيق ورود طبيعية على متن الطائرة.',
  'Fresh floral arrangement on board.',
  1000, 500, 1500,
  false, 30, false, false,
  'advisor:5.1 floral_arrangement'
),
(
  'celebration', 'special',
  'احتفال خاص', 'Celebration Package',
  'كيك وهدايا واحتفال داخل الطائرة.',
  'Cake, gifts, and an in-flight celebration setup.',
  4000, 2000, 6000,
  false, 25, false, false,
  'advisor:5.1 celebration'
),
(
  'photographer', 'special',
  'مصور رحلات', 'Onboard Photographer',
  'مصور محترف لتوثيق الرحلة.',
  'Professional photographer to document the trip.',
  5500, 3000, 8000,
  false, 20, false, false,
  'advisor:5.1 photographer'
),
(
  'masseur', 'special',
  'مدلك على متن الطائرة', 'Onboard Masseur',
  'مدلك أو مدلكة محترف(ة) خلال الرحلة.',
  'Professional masseur during the flight.',
  3750, 2500, 5000,
  false, 18, false, false,
  'advisor:5.1 masseur'
),
(
  'prayer_kit', 'special',
  'سجادة صلاة وتجهيز ديني', 'Prayer Kit',
  'سجادة صلاة ومستلزمات دينية — مجاني.',
  'Prayer mat and religious essentials — complimentary.',
  0, 0, 0,
  false, 0, false, true,
  'advisor:5.1 prayer_kit'
),
(
  'child_accessories', 'special',
  'تجهيز كامل للأطفال', 'Child Accessories',
  'مستلزمات الأطفال (مقاعد، طعام، ألعاب).',
  'Child essentials (seats, meals, toys).',
  1150, 800, 1500,
  false, 25, false, false,
  'advisor:5.1 child_accessories'
),
(
  'pet_transport', 'special',
  'نقل حيوانات أليفة', 'Pet Transport',
  'تجهيزات نقل حيوان أليف على متن الطائرة.',
  'On-board pet transport setup.',
  2000, 1000, 3000,
  false, 30, false, false,
  'advisor:5.1 pet_transport'
),
(
  'onboard_doctor', 'special',
  'طبيب مرافق', 'Onboard Doctor',
  'طبيب أو طبيبة لمرافقة الرحلة الطبية.',
  'Doctor escorting the flight (medical support).',
  14000, 8000, 20000,
  false, 15, false, false,
  'advisor:5.1 onboard_doctor'
),
(
  'vip_security', 'special',
  'حراسة شخصية VIP', 'VIP Personal Security',
  'حراسة شخصية مدربة لكبار الشخصيات.',
  'Trained personal security for VIPs.',
  6500, 3000, 10000,
  false, 20, false, false,
  'advisor:5.1 vip_security'
),
(
  'live_music', 'special',
  'موسيقى حية', 'Live Music',
  'عازف موسيقى حية على متن الطائرة.',
  'Live musician performing on board.',
  10000, 5000, 15000,
  false, 22, false, false,
  'advisor:5.1 live_music'
),
(
  'airport_vip', 'special',
  'تخليص VIP بالمطار', 'Airport VIP Clearance',
  'تخليص جوازات وأمتعة بمسار VIP داخل المطار.',
  'VIP fast-track passport and baggage clearance at the airport.',
  1000, 500, 1500,
  false, 40, false, false,
  'advisor:5.1 airport_vip'
),
(
  'diplomatic_protocol', 'special',
  'بروتوكول دبلوماسي', 'Diplomatic Protocol',
  'استقبال دبلوماسي رسمي عند الوصول والمغادرة.',
  'Formal diplomatic reception on arrival and departure.',
  3500, 2000, 5000,
  false, 25, false, false,
  'advisor:5.1 diplomatic_protocol'
)
ON CONFLICT (subtype) DO UPDATE SET
  addon_type = EXCLUDED.addon_type,
  label_ar = EXCLUDED.label_ar,
  label_en = EXCLUDED.label_en,
  description_ar = EXCLUDED.description_ar,
  description_en = EXCLUDED.description_en,
  unit_price_sar = EXCLUDED.unit_price_sar,
  unit_price_min_sar = EXCLUDED.unit_price_min_sar,
  unit_price_max_sar = EXCLUDED.unit_price_max_sar,
  per_passenger = EXCLUDED.per_passenger,
  commission_rate_pct = EXCLUDED.commission_rate_pct,
  allow_quantity = EXCLUDED.allow_quantity,
  free = EXCLUDED.free,
  advisor_ref = EXCLUDED.advisor_ref;

-- ============================================================
-- END OF FILE C
--
-- Post-File-C shape (founder Probe 2b verifies):
--   - addon_catalog table exists with exactly 20 rows.
--   - RLS enabled, no policies (deny-all to anon +
--     authenticated).
--   - Every row matches the corresponding TS ADDONS_CATALOG
--     entry field-for-field (subtype + addon_type + Arabic/
--     English labels + descriptions + unit_price_sar +
--     unit_price_min_sar + unit_price_max_sar +
--     per_passenger + commission_rate_pct + allow_quantity +
--     free + advisor_ref).
--   - subtype PK set matches the booking_addons_subtype_check
--     IN clause (File A) exactly.
-- ============================================================
