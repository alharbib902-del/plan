# Phase 11 — Aeris Cargo (Special Cargo Charter)

> **Status:** Draft for Codex review (round 5).
> **Codex history:** rounds 1-4 closed 10 P1 + 7 P2 (17 findings):
> - **Round 1 (4 P1 + 1 P2):** P1 #1 (§3.4 extended
>   bookings_source_offer_check too — not just
>   source_discriminator), P1 #2 (§4.3 business_name →
>   company_name), P1 #3 (§4.1 + §4.2 text allowlist before
>   ENUM cast), P1 #4 (§3.2 aircraft_id NOT NULL + §4.3
>   capability check unconditional), P2 #5 (3 CREATE TYPE
>   wrapped in pg_type DO block guards).
> - **Round 2 (2 P1 + 2 P2):** P1 #1 (§4.3 UUID cast in
>   BEGIN/EXCEPTION block — `aircraft_id_invalid` structured
>   error catches malformed values like `'not-a-uuid'`),
>   P1 #2 (§3.2 3 named price CHECKs + §4.3 GET STACKED
>   DIAGNOSTICS CONSTRAINT_NAME match → structured
>   `price_invalid`; SQLERRM substring matching avoided),
>   P2 #3 (§3.3 ON DELETE RESTRICT + invariant CHECK
>   `cargo_requests_accepted_has_offer_check`), P2 #4 (§5
>   PR 1 manifest now lists §3.4.2 explicitly).
>
> - **Round 3 (1 P1 + 3 P2):** P1 #1 (§3.2 operator snapshot
>   widths widened 120→200/255 to match source operators
>   schema; prior widths would `value too long` on legitimate
>   approved operators), P2 #2 (`IF NOT EXISTS` on every
>   `CREATE TABLE` + `CREATE INDEX` — partial replay safety;
>   complements round 1 ENUM DO block guards), P2 #3 (§3.1
>   strict category CHECK rejects cross-category fields —
>   each cargo_type branch now requires the OTHER 3
>   categories' fields to be NULL), P2 #4 (§3.1 added
>   `cargo_requests_value_positive_check` +
>   `cargo_requests_date_order_check` named CHECKs +
>   structured `value_invalid` + `date_invalid` errors via
>   GET STACKED DIAGNOSTICS in §4.1 + §4.2).
>
> - **Round 4 (3 P1 + 1 P2):** P1 #1 (§4.4 deadlock-safe lock
>   order — lock parent request FIRST then lock all sibling
>   offers in id-ORDER, eliminating the ABBA cycle on
>   concurrent accepts), P1 #2 (§4.1 + §4.2 NOT NULL guards
>   on the 4 required intake fields → structured
>   `customer_name_required` / `customer_phone_required` /
>   `pickup_date_required` / `estimated_value_required`
>   instead of raw 23502 escape), P1 #3 (§4.3 NOT NULL
>   guards on the 3 required offer fields → structured
>   `base_price_required` / `proposed_pickup_date_required` /
>   `proposed_delivery_date_required`), P2 #4 (§4.4
>   `actor_required` guard rejects the all-NULL actor case
>   at DB boundary as defense-in-depth — Server Action layer
>   stays primary auth gate).
>
> Round 5 should verify the §4.4 deadlock fix uses
> deterministic id-ORDER lock acquisition (not just
> "lock request then offer"), that the new 7 NOT NULL
> guards return BEFORE any DB write attempt (so they
> can't be confused with the existing CHECK-based
> structured errors), and that the §4.4 contracts table
> documents all 9 possible error codes including the new
> `actor_required`.
> **Predecessor:** Phase 10 — Empty Legs Client-Side Portal —
> live in production at HEAD `1035313` (PR #63 merged
> 2026-05-15). All 7 founder probes (21-27) passed.
> Phase 10 closure ceremony deferred 2-4 days for monitoring;
> this Phase 11 spec PR opens **in parallel** without touching
> Phase 10 docs.
>
> **Scope (locked).** 4 PRs total:
> 1. **Spec PR** — this document, locked decisions + probes.
> 2. **PR 1** — backend + public `/cargo` form + admin intake.
> 3. **PR 2** — authed `/me/cargo-requests` portal + offers
>    + booking integration + `/me/bookings` extension.
> 4. **PR 3** — distribution engine + ops polish (founder
>    batch alerts, rate limits, observability).
>
> Every PR in this phase MUST clear Codex 100/100 before
> merge. **No payment integration in this phase** (per founder
> directive in `MEMORY.md`: payment + ZATCA = single final
> phase wiring HyperPay + Moyasar + ZATCA at once. Phase 11
> bookings ship with `payment_status='pending_offline'` like
> Phase 6/7/9/10).

---

## 0. Objective

Aeris Cargo extends the platform from passenger transport
(Phase 6/9 charter + Phase 7/10 empty legs) to **specialized
cargo charter**: high-value, bespoke shipments that don't fit
commercial cargo workflows.

**v1 cargo categories (Decision #1 below):**
- **Horses** — racehorses + Arabian stallions, requires CITES
  + vet certificates + specialized stalls
- **Luxury cars** — Ferrari/Lamborghini/Bugatti/classic cars,
  requires customs clearance + enclosed handling + insurance
- **Valuables** — jewelry/art/exhibition pieces/premium
  electronics, requires high-security handling + climate
  control + declared-value insurance
- **Other** — freeform category for non-standard shipments
  (admin reviews + qualifies before dispatch)

Each cargo type carries category-specific fields on top of a
shared shipment shape (origin/destination, time window, value
estimate, insurance preference, contact). The matching engine
+ pricing depend on type-specific aircraft suitability (e.g.
horses need IAG-style equine cargo planes, luxury cars need
wide-body belly hold or Antonov-style freighters).

The flow mirrors Phase 9 charter (request → operators/offers
→ client accepts → booking) for these reasons:
- Cargo is bespoke + high-value; requires admin oversight
  before booking confirmation.
- Pricing is per-shipment, not per-seat — needs operator
  quote, not auto-calculated.
- Insurance + customs + permits are case-by-case — operators
  qualify themselves per request.
- `bookings.source_discriminator='cargo'` keeps unified
  `/me/bookings` consistent with Phase 10 Decision #10.

---

## 1. User journeys

### J1 — Public visitor (guest) submits cargo request
1. Visitor lands on `aeris-flax.vercel.app/cargo`.
2. Selects cargo type (horses / luxury_car / valuables / other).
3. Fills shared fields + category-specific fields.
4. Submits → `cargo_requests` row created with
   `client_id = NULL` + `customer_*_snapshot` fields populated.
5. Confirmation page shows reference number `CGO-XXXX` +
   "سنتواصل معك خلال X ساعة" + (optional) login CTA.
6. Founder sees the row in `/admin/cargo` queue + dispatches
   manually (PR 3 will add auto-distribution).

### J2 — Authenticated client submits cargo request
1. Client opens `/me/cargo-requests`.
2. Clicks "طلب شحن جديد" → form with the same fields as J1
   but `client_id` pre-filled from session, `contact_*` fields
   pre-filled from `clients` profile.
3. Submits → `cargo_requests` row with `client_id` populated
   (NOT NULL) + snapshot fields ALSO populated (immutable
   audit trail per Phase 9 PR 2 Decision #4 pattern).
4. Redirect to `/me/cargo-requests/<request_id>` showing the
   submitted request + offer history (empty initially).
5. Operator sends offer → client sees on `/me/cargo-requests/<id>`
   + on `/me/offers` (Phase 9 unified offer surface extended).

### J3 — Cargo operator dispatches → offer → accept → booking
1. Founder runs cargo distribution (PR 3 — manual
   `/admin/cargo/<id>/distribute` button OR auto via
   `lib/automation/cargo-distribution.ts` cron).
2. Eligible cargo operators (per `cargo_aircraft_capabilities`
   table — see §3.5) receive WhatsApp link + email with the
   request details.
3. Operator submits offer via `/operator/cargo/offers/new`
   (Phase 8 operator portal extension) with
   per-cargo-type pricing fields.
4. Client (authed J2) or admin (guest J1) reviews offers on
   `/me/cargo-requests/<id>` or `/admin/cargo/<id>` and
   accepts one.
5. Acceptance → `bookings` row with
   `source_discriminator='cargo'` + `source_offer_table='cargo_offers'`
   + `source_offer_id=<offer.id>`.
6. Booking surfaces in `/me/bookings` (chip "شحن") +
   `/admin/bookings`.

### J4 — Unified `/me/bookings` (extends Phase 10 Decision #10)
1. Client opens `/me/bookings`.
2. Table shows ALL their bookings: charter (طيران خاص) +
   empty leg (رحلة فارغة) + cargo (شحن).
3. Source chip differentiates origin per
   `BookingsSourceChip` extended to 3 values.

---

## 2. Locked decisions

These are settled before spec acceptance:

1. **Cargo categories v1 = 4 (founder approved).** `horse` +
   `luxury_car` + `valuables` + `other`. ENUM at DB level;
   per-category required-fields enforced at app + Zod layer
   (NOT a polymorphic JSONB schema — fixed columns + nullable
   per-category fields, easier to audit + index).
2. **Architecture: Charter pattern.** request → operators
   → offers → client accepts → booking. NO empty-leg-style
   capacity slots in v1 (deferred to a later phase if demand
   appears). Justification (founder direction):
   > Cargo high-value, bespoke, evaluation/pricing different
   > per shipment, permits, handling, destination, timing,
   > insurance. The model `request → operators/offers →
   > client accepts → booking` is closest to reality and
   > re-uses Phase 9 with minimal risk: client portal
   > already exists, trip requests/offers/accept/booking
   > pattern proven, dispatch + auto-distribution lessons
   > ready, maintains admin oversight before booking, easier
   > for audit and ZATCA later than capacity slots.
3. **Both public + authed portal.** Public `/cargo` form for
   guests (Phase 7 lead-style) + authed
   `/me/cargo-requests` for clients (Phase 9-style). Funnel
   cap: a public form CTA reads "لديك حساب؟ سجّل الدخول
   لمتابعة الطلب" linking to `/login?redirect=/me/cargo-requests`.
4. **3 implementation PRs (founder direction):**
   - PR 1: backend (migration + RPCs + Server Actions) +
     public `/cargo` form + admin intake page
   - PR 2: authed portal + offer/booking integration +
     `/me/bookings` extension to 3 source chips
   - PR 3: distribution + ops polish (founder batch
     alerts, rate limits, canary card #6, frequency caps,
     observability)
5. **Source discriminator extension.** `bookings.source_discriminator`
   ENUM (Phase 10 §3.4) extended from `('charter', 'empty_leg')`
   to `('charter', 'empty_leg', 'cargo')`. The Phase 10
   bookings_source_discriminator_check named constraint is
   DROP + RECREATE'd with the extended set in PR 1
   migration (replay-safe DO block guard mirrors Phase 10
   §3.4 step 3 discipline). NO new `source_offer_table`
   value invented — `source_offer_table='cargo_offers'`
   matches the new `cargo_offers` table name.
6. **Payment-pluggable architecture (carries from MEMORY.md
   directive).** Every Phase 11 booking ships with
   `payment_status='pending_offline'` (Decision #12 from
   Phase 10). Final HyperPay + Moyasar + ZATCA wiring lives
   in Phase 14 (per roadmap). Phase 11 RPCs MUST NOT touch
   `payment_status` beyond setting the default —
   `payment_status` evolution is reserved for Phase 14.
7. **Operator capability matrix (NEW — §3.5).** A new
   `cargo_aircraft_capabilities` table maps `aircraft_id` →
   per-category boolean flags (`supports_horse`,
   `supports_luxury_car`, `supports_valuables`,
   `supports_other`). The distribution engine joins via
   this to filter eligible operators per request type.
   Founder seeds the table manually for now via admin UI;
   Phase 12+ may auto-populate from operator-self-declared
   aircraft profiles.
8. **NO auto-confirmation.** Unlike Phase 7 empty legs (admin
   confirms reservation → booking), Phase 11 cargo
   acceptance is **client-initiated** (`/me/cargo-requests/<id>`
   has "اقبل العرض" button) OR **admin-initiated** for
   guest requests (`/admin/cargo/<id>/accept-offer`).
   Both paths flow through the same RPC
   `accept_cargo_offer` (mirrors Phase 9 `accept_offer`
   shape) which handles guest vs authed branching.
9. **Cargo-specific timing window.** Unlike empty legs
   (auction window) or charter (departure_scheduled), cargo
   uses `pickup_date` + `delivery_date_target` (date-only,
   no time-of-day) + `flexibility_days` (INT, 0-7). The
   flexibility is shown to operators when quoting so they
   can offer alternative dates.
10. **No frequency cap on cargo requests.** Cargo is
    high-value bespoke; clients submit ≤ a few per year on
    average. NO 24h rate cap (unlike Phase 7 empty-leg
    notifications). PR 3 adds per-CLIENT submission rate
    monitoring (alert if > 3 submissions / 7 days — likely
    spam or testing) but does NOT auto-block.
11. **Codex 100/100 mandatory** before any merge to main
    (carries forward from Phase 9 + 10 conventions).
12. **No Functions map entries** in `types/database.ts`
    for new RPCs (mirror of Phase 8 PR 2e #48 + Phase 9 PR 1
    convention #1 — `looseClient()` cast pattern is the only
    way new code calls RPCs).

---

## 3. Schema additions

### §3.1 — `cargo_requests` table (NEW)

The intake table for both J1 (guest) + J2 (authed) flows.

**Codex round 1 PR #64 P2 #5 fix — replay-safe ENUM creation.**
PostgreSQL does NOT support `CREATE TYPE IF NOT EXISTS` for
ENUMs. A raw `CREATE TYPE` fails with `type "..." already
exists` on any replay (staging restore, partial rollback,
re-applied migration). Wrap each ENUM in a `pg_type` lookup
DO block, mirroring the Phase 8 ENUM discipline.

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'cargo_type'
       AND n.nspname = 'public'
  ) THEN
    CREATE TYPE cargo_type AS ENUM (
      'horse', 'luxury_car', 'valuables', 'other'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'cargo_request_status'
       AND n.nspname = 'public'
  ) THEN
    CREATE TYPE cargo_request_status AS ENUM (
      'pending',           -- waiting for offers
      'offers_received',   -- ≥1 offer in
      'accepted',          -- offer accepted → booking created
      'cancelled',         -- client/admin cancelled before acceptance
      'expired'            -- 14-day TTL hit without acceptance
    );
  END IF;
END $$;

-- Codex round 3 PR #64 P2 #2 fix — IF NOT EXISTS on every
-- CREATE TABLE + CREATE INDEX in PR 1's migration. PostgreSQL
-- does support these clauses for tables + indexes (unlike
-- ENUM CREATE TYPE which needs the pg_type DO block guard
-- per round 1 P2 #5). Mirrors Phase 8 + Phase 9 migration
-- discipline; ensures partial replays + staging restores
-- don't fail with "relation already exists".
CREATE TABLE IF NOT EXISTS cargo_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_request_number VARCHAR(20) NOT NULL UNIQUE
    DEFAULT ('CGO-' || SUBSTR(MD5(uuid_generate_v4()::TEXT), 1, 8)),

  -- Identity (matches Phase 9 PR 2 immutable-snapshot pattern)
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
  customer_name_snapshot VARCHAR(120) NOT NULL,
  customer_phone_snapshot VARCHAR(20) NOT NULL,
  customer_email_snapshot VARCHAR(120),

  -- Cargo classification
  cargo_type cargo_type NOT NULL,

  -- Shared shipment fields
  origin_iata VARCHAR(4),
  origin_freeform TEXT,
  destination_iata VARCHAR(4),
  destination_freeform TEXT,
  pickup_date DATE NOT NULL,
  delivery_date_target DATE,
  flexibility_days INT NOT NULL DEFAULT 0
    CHECK (flexibility_days >= 0 AND flexibility_days <= 7),

  -- Value + insurance.
  -- Codex round 3 PR #64 P2 #4 fix — `estimated_value_sar > 0`.
  -- Mirrors §3.2 cargo_offers_base_price_positive_check; zero-
  -- valued cargo doesn't make business sense + breaks
  -- downstream insurance/pricing math. Named CHECK so §4.1 +
  -- §4.2 can disambiguate via GET STACKED DIAGNOSTICS.
  estimated_value_sar DECIMAL(14, 2) NOT NULL
    CONSTRAINT cargo_requests_value_positive_check
      CHECK (estimated_value_sar > 0),
  insurance_required BOOLEAN NOT NULL DEFAULT false,

  -- Free text
  handling_notes TEXT,

  -- Per-category fields (NULLable; enforced at app + Zod layer)
  -- horses
  horse_count INT
    CHECK (horse_count IS NULL OR (horse_count > 0 AND horse_count <= 30)),
  horse_groom_required BOOLEAN,
  horse_cites_status TEXT
    CHECK (horse_cites_status IS NULL
      OR horse_cites_status IN ('ready', 'in_progress', 'help_needed')),
  horse_stall_requirements TEXT,

  -- luxury cars
  car_make TEXT,
  car_model TEXT,
  car_year INT
    CHECK (car_year IS NULL OR (car_year >= 1900 AND car_year <= 2100)),
  car_running_condition BOOLEAN,
  car_enclosed_required BOOLEAN,

  -- valuables
  valuables_declared_value_sar DECIMAL(14, 2),
  valuables_security_level TEXT
    CHECK (valuables_security_level IS NULL
      OR valuables_security_level IN ('standard', 'high', 'armed_escort')),
  valuables_climate_controlled BOOLEAN,
  valuables_item_description TEXT,

  -- other (freeform)
  other_description TEXT,
  other_dimensions_lwh_cm TEXT,
  other_weight_kg DECIMAL(10, 2),
  other_special_handling TEXT,

  -- Status + audit
  status cargo_request_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  accepted_offer_id UUID,  -- FK added in §3.3 after cargo_offers exists

  -- Phase 9 immutable-snapshot pattern
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identity check: either client_id OR (customer_name_snapshot
  -- + customer_phone_snapshot) must be present. Snapshots are
  -- ALWAYS populated even when client_id is set (immutable
  -- audit per Decision #4 from Phase 9 PR 2).
  CONSTRAINT cargo_requests_identity_check CHECK (
    customer_name_snapshot IS NOT NULL
    AND customer_phone_snapshot IS NOT NULL
  ),

  -- Per-category required + exclusivity check (defense-in-depth;
  -- app-level Zod is the primary line).
  --
  -- Codex round 3 PR #64 P2 #3 fix — strict category CHECK.
  -- The prior draft only enforced the per-category minimum
  -- (e.g. cargo_type='horse' AND horse_count IS NOT NULL),
  -- but allowed cross-category fields to be populated alongside
  -- (e.g. cargo_type='horse' + horse_count=2 + car_make='Ferrari'
  -- → ambiguous audit + UI state). Each branch now also
  -- requires the OTHER three categories' fields to be NULL,
  -- ensuring every row has exactly one populated category
  -- field block.
  CONSTRAINT cargo_requests_category_required_check CHECK (
    (cargo_type = 'horse'
      AND horse_count IS NOT NULL
      -- forbid luxury_car fields
      AND car_make IS NULL
      AND car_model IS NULL
      AND car_year IS NULL
      AND car_running_condition IS NULL
      AND car_enclosed_required IS NULL
      -- forbid valuables fields
      AND valuables_declared_value_sar IS NULL
      AND valuables_security_level IS NULL
      AND valuables_climate_controlled IS NULL
      AND valuables_item_description IS NULL
      -- forbid other fields
      AND other_description IS NULL
      AND other_dimensions_lwh_cm IS NULL
      AND other_weight_kg IS NULL
      AND other_special_handling IS NULL)
    OR (cargo_type = 'luxury_car'
      AND car_make IS NOT NULL
      AND car_model IS NOT NULL
      -- forbid horse fields
      AND horse_count IS NULL
      AND horse_groom_required IS NULL
      AND horse_cites_status IS NULL
      AND horse_stall_requirements IS NULL
      -- forbid valuables fields
      AND valuables_declared_value_sar IS NULL
      AND valuables_security_level IS NULL
      AND valuables_climate_controlled IS NULL
      AND valuables_item_description IS NULL
      -- forbid other fields
      AND other_description IS NULL
      AND other_dimensions_lwh_cm IS NULL
      AND other_weight_kg IS NULL
      AND other_special_handling IS NULL)
    OR (cargo_type = 'valuables'
      AND valuables_declared_value_sar IS NOT NULL
      -- forbid horse fields
      AND horse_count IS NULL
      AND horse_groom_required IS NULL
      AND horse_cites_status IS NULL
      AND horse_stall_requirements IS NULL
      -- forbid luxury_car fields
      AND car_make IS NULL
      AND car_model IS NULL
      AND car_year IS NULL
      AND car_running_condition IS NULL
      AND car_enclosed_required IS NULL
      -- forbid other fields
      AND other_description IS NULL
      AND other_dimensions_lwh_cm IS NULL
      AND other_weight_kg IS NULL
      AND other_special_handling IS NULL)
    OR (cargo_type = 'other'
      AND other_description IS NOT NULL
      -- forbid horse fields
      AND horse_count IS NULL
      AND horse_groom_required IS NULL
      AND horse_cites_status IS NULL
      AND horse_stall_requirements IS NULL
      -- forbid luxury_car fields
      AND car_make IS NULL
      AND car_model IS NULL
      AND car_year IS NULL
      AND car_running_condition IS NULL
      AND car_enclosed_required IS NULL
      -- forbid valuables fields
      AND valuables_declared_value_sar IS NULL
      AND valuables_security_level IS NULL
      AND valuables_climate_controlled IS NULL
      AND valuables_item_description IS NULL)
  ),

  -- Route presence (mirrors Phase 6.2 +
  -- empty_legs_*_present_check pattern)
  CONSTRAINT cargo_requests_origin_present_check CHECK (
    origin_iata IS NOT NULL OR origin_freeform IS NOT NULL
  ),
  CONSTRAINT cargo_requests_destination_present_check CHECK (
    destination_iata IS NOT NULL OR destination_freeform IS NOT NULL
  ),

  -- Codex round 3 PR #64 P2 #4 fix — date order CHECK on
  -- intake mirrors §3.2 cargo_offers_date_order_check. Allows
  -- delivery_date_target to be NULL (client may leave it
  -- open-ended for the operator to propose); when set, it
  -- must be on or after pickup_date.
  CONSTRAINT cargo_requests_date_order_check CHECK (
    delivery_date_target IS NULL
    OR delivery_date_target >= pickup_date
  )
);

CREATE INDEX IF NOT EXISTS idx_cargo_requests_client
  ON cargo_requests (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_requests_status
  ON cargo_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_requests_pickup
  ON cargo_requests (pickup_date)
  WHERE status IN ('pending', 'offers_received');
```

### §3.2 — `cargo_offers` table (NEW)

```sql
-- Codex round 1 PR #64 P2 #5 fix — replay-safe ENUM creation
-- (mirror of §3.1 pattern).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typname = 'cargo_offer_status'
       AND n.nspname = 'public'
  ) THEN
    CREATE TYPE cargo_offer_status AS ENUM (
      'pending',     -- operator submitted, awaiting client/admin decision
      'accepted',    -- client/admin accepted → booking created
      'declined',    -- client/admin explicitly declined
      'withdrawn',   -- operator pulled the offer
      'expired'      -- offer's TTL hit before accept/decline
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cargo_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_request_id UUID NOT NULL
    REFERENCES cargo_requests(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL
    REFERENCES operators(id) ON DELETE RESTRICT,
  -- Codex round 1 PR #64 P1 #4 fix — aircraft_id NOT NULL.
  -- The prior nullable shape allowed an operator to submit
  -- an offer without an aircraft_id; §4.3's capability check
  -- only fires when v_aircraft_id IS NOT NULL, so an operator
  -- could bypass the cargo_aircraft_capabilities matrix
  -- entirely by simply omitting aircraft_id from the offer
  -- payload. NOT NULL forces every cargo offer to declare
  -- which specific aircraft will fly it, which the §4.3
  -- capability check then verifies against the §3.5 matrix.
  --
  -- ON DELETE RESTRICT on the FK so an operator cannot
  -- silently delete a referenced aircraft and orphan the
  -- offer's audit trail. Phase 11 ops PR (PR 3) may extend
  -- with admin-side aircraft retirement workflow if needed.
  aircraft_id UUID NOT NULL
    REFERENCES aircraft(id) ON DELETE RESTRICT,

  -- Snapshots (Phase 9 PR 2 Decision #4 immutability).
  -- Codex round 3 PR #64 P1 #1 fix — widen to match the
  -- source operators schema:
  --   - operators.company_name = VARCHAR(200) — snapshot
  --     was 120, would `value too long` on any operator
  --     with company_name length 121-200 (the legitimate
  --     range allowed by the source table)
  --   - operators.contact_email = VARCHAR(255) — snapshot
  --     was 120, would reject any RFC-compliant email
  --     longer than 120 chars (which the operators table
  --     accepts up to 255)
  --   - operators.contact_phone = VARCHAR(20) — snapshot
  --     already matches at 20
  -- All 3 widened to source-schema width so EVERY approved
  -- operator can submit a cargo offer without truncation
  -- or rejection.
  operator_name_snapshot VARCHAR(200) NOT NULL,
  operator_phone_snapshot VARCHAR(20) NOT NULL,
  operator_email_snapshot VARCHAR(255) NOT NULL,
  aircraft_snapshot TEXT,

  -- Offer terms. Codex round 2 PR #64 P1 #2 fix — non-negative
  -- price CHECKs. The prior draft had no constraints, so a
  -- buggy/malicious operator submission could create a cargo
  -- offer with negative/zero base_price_sar; §4.4
  -- accept_cargo_offer copies these directly into
  -- bookings.total_amount, producing negative cargo bookings
  -- that downstream payment + ZATCA flows can't reason about.
  --
  --   - base_price_sar > 0 (must be POSITIVE — zero-priced
  --     cargo flights are not a valid business case)
  --   - insurance_price_sar >= 0 (zero allowed when client
  --     opts out of insurance)
  --   - customs_handling_price_sar >= 0 (zero allowed for
  --     domestic shipments without customs)
  --
  -- The §4.3 submit_cargo_offer RPC catches violations and
  -- returns the structured `price_invalid` contract code.
  base_price_sar DECIMAL(14, 2) NOT NULL
    CONSTRAINT cargo_offers_base_price_positive_check
      CHECK (base_price_sar > 0),
  insurance_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT cargo_offers_insurance_price_nonneg_check
      CHECK (insurance_price_sar >= 0),
  customs_handling_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT cargo_offers_customs_handling_nonneg_check
      CHECK (customs_handling_price_sar >= 0),
  total_price_sar DECIMAL(14, 2) GENERATED ALWAYS AS (
    base_price_sar + insurance_price_sar + customs_handling_price_sar
  ) STORED,

  -- Schedule the operator can commit to
  proposed_pickup_date DATE NOT NULL,
  proposed_delivery_date DATE NOT NULL,

  -- Operator notes for the client (e.g. "subject to vet
  -- inspection", "requires 48h customs clearance window")
  operator_notes TEXT,

  -- Status + audit
  status cargo_offer_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  decided_at TIMESTAMPTZ,
  decided_by_user_id UUID,  -- NULL for guest path; client.id for authed; admin id stashed in audit_logs

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Date sanity
  CONSTRAINT cargo_offers_date_order_check CHECK (
    proposed_delivery_date >= proposed_pickup_date
  )
);

CREATE INDEX IF NOT EXISTS idx_cargo_offers_request
  ON cargo_offers (cargo_request_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_offers_operator
  ON cargo_offers (operator_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_offers_pending
  ON cargo_offers (cargo_request_id, status)
  WHERE status = 'pending';
```

### §3.3 — `cargo_requests.accepted_offer_id` FK + invariant

`cargo_requests.accepted_offer_id` is declared NULLable in
§3.1 but no FK constraint binds it yet. We add the FK
**after** `cargo_offers` exists in §3.2 to avoid a
forward-reference circular dependency.

**Codex round 2 PR #64 P2 #3 fix.** The prior draft used
`ON DELETE SET NULL`. If the accepted offer row was ever
deleted (admin error, bulk cleanup script, manual
intervention), `cargo_requests.accepted_offer_id` would
silently become NULL while `status='accepted'` stays — an
orphan state that breaks the audit trail + the unified
`/me/bookings` lookup (which joins through this column to
display the booking's offer breakdown).

Two-layer defense:
1. **`ON DELETE RESTRICT`** — Postgres refuses to delete
   any `cargo_offers` row that's still referenced by a
   `cargo_requests.accepted_offer_id`. Operationally this
   means: before bulk-deleting accepted offers (e.g. PII
   purge for a closed account), admin must first transition
   the parent request out of `'accepted'` (e.g. a hard cancel
   RPC that nulls accepted_offer_id + flips status to
   `'cancelled'`). Phase 11 ships no such bulk-delete tool;
   the constraint exists as defense against accidental
   Studio deletions.
2. **CHECK invariant** — even if a future migration
   accidentally relaxes the FK to SET NULL, this CHECK
   ensures `status='accepted'` rows always carry a non-NULL
   `accepted_offer_id`. The CHECK is added in a separate
   replay-safe DO block.

```sql
-- Step 1: add the FK with ON DELETE RESTRICT (Codex round 2
-- P2 #3 fix; was SET NULL in the prior draft).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_accepted_offer_fkey'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_accepted_offer_fkey
      FOREIGN KEY (accepted_offer_id)
      REFERENCES cargo_offers(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Step 2: add the invariant CHECK (defense-in-depth — even
-- if the FK is ever weakened, accepted requests cannot lose
-- their offer pointer).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cargo_requests_accepted_has_offer_check'
       AND conrelid = 'cargo_requests'::regclass
  ) THEN
    ALTER TABLE cargo_requests
      ADD CONSTRAINT cargo_requests_accepted_has_offer_check
      CHECK (
        status <> 'accepted' OR accepted_offer_id IS NOT NULL
      );
  END IF;
END $$;
```

The CHECK is `OR`-shaped (not `AND`-shaped) so non-accepted
statuses (`pending`, `offers_received`, `cancelled`,
`expired`) can carry NULL `accepted_offer_id` freely. Only
the `accepted` row state requires the pointer.

### §3.4 — `bookings` constraint extensions

**Two constraints must be extended for cargo bookings to land
without violations** (Codex round 1 PR #64 P1 #1 fix — the
prior draft only extended `source_discriminator` and forgot
`bookings_source_offer_check`; the first cargo accept would
have failed with `check_violation` at INSERT time).

**§3.4.1 — `bookings.source_discriminator` CHECK extension.**
Phase 10 §3.4 created the named CHECK with
`source_discriminator IN ('charter', 'empty_leg')`. Phase 11
extends to add `'cargo'`:

```sql
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_discriminator_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_discriminator_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_discriminator_check
      CHECK (source_discriminator IN ('charter', 'empty_leg', 'cargo'));
  END IF;
END $$;
```

**§3.4.2 — `bookings.source_offer_table` CHECK extension
(Codex round 1 P1 #1 fix).** The pre-Phase-11 constraint
was set by Phase 7 reshape migration §5
(`20260509000010_phase_7_empty_legs_reshape.sql:139`):

```sql
-- Pre-Phase-11 state (DO NOT RE-RUN):
ALTER TABLE bookings
  ADD CONSTRAINT bookings_source_offer_check CHECK (
    source_offer_table IN ('phase4', 'phase5', 'phase7_empty_leg')
    OR source_offer_table IS NULL
  );
```

Phase 11 §4.4 `accept_cargo_offer` writes
`source_offer_table = 'cargo_offers'`. Without extending the
constraint, the first accept would fail with
`check_violation`. Extend with the same DROP + replay-safe DO
block recreate pattern:

```sql
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_offer_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bookings_source_offer_check'
       AND conrelid = 'bookings'::regclass
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_source_offer_check CHECK (
        source_offer_table IN ('phase4', 'phase5', 'phase7_empty_leg', 'cargo_offers')
        OR source_offer_table IS NULL
      );
  END IF;
END $$;
```

The Phase 10 `idx_bookings_client_source` partial index
needs no change — it's keyed on `client_id` + `source_discriminator`
+ `created_at` and works for all 3 discriminator values.

**Probe 28 verifies BOTH extended CHECKs.**

### §3.5 — `cargo_aircraft_capabilities` table (NEW)

Maps each aircraft to per-cargo-type suitability. The
distribution engine (PR 3) joins via this table to filter
operators that have at least one capable aircraft.

```sql
CREATE TABLE IF NOT EXISTS cargo_aircraft_capabilities (
  aircraft_id UUID PRIMARY KEY
    REFERENCES aircraft(id) ON DELETE CASCADE,
  supports_horse BOOLEAN NOT NULL DEFAULT false,
  supports_luxury_car BOOLEAN NOT NULL DEFAULT false,
  supports_valuables BOOLEAN NOT NULL DEFAULT false,
  supports_other BOOLEAN NOT NULL DEFAULT false,

  -- Capacity hints (NOT enforced; advisory for the matcher)
  max_horse_count INT,
  max_car_count INT,
  max_payload_kg DECIMAL(10, 2),

  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- At least one supports_* flag must be true; otherwise
  -- the row has no purpose.
  CONSTRAINT cargo_aircraft_capabilities_at_least_one_check CHECK (
    supports_horse OR supports_luxury_car OR supports_valuables OR supports_other
  )
);

CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_horse
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_horse;
CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_car
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_luxury_car;
CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_valuables
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_valuables;
CREATE INDEX IF NOT EXISTS idx_cargo_aircraft_caps_other
  ON cargo_aircraft_capabilities (aircraft_id) WHERE supports_other;
```

PR 1 ships an admin UI page `/admin/cargo/aircraft-capabilities`
to seed + maintain rows. Every operator's aircraft starts
NOT in this table → operator NOT eligible for cargo dispatch
until founder confirms capabilities.

### §3.6 — `cargo_email_alert_status` singleton (NEW)

Mirrors the Phase 7 outreach + Phase 8 + Phase 9 + Phase 10
alert-singleton pattern. Tracks Resend health for
client-side cargo emails (offer-received notifications +
offer-accepted confirmations + offer-declined notices +
admin batch alerts to operators).

```sql
CREATE TABLE IF NOT EXISTS cargo_email_alert_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cargo_email_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE cargo_email_alert_status ENABLE ROW LEVEL SECURITY;
```

The 6th `<ChannelHealth>` card on `/admin/operators/canary`
reads from this in PR 3.

---

## 4. RPC layer

### §4.1 — `create_cargo_request_guest` (NEW, public path)

Public guest submission via `/cargo` form. No session required.

```sql
CREATE OR REPLACE FUNCTION create_cargo_request_guest(
  p_payload JSONB,
  p_ip INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_request_id UUID;
  v_request_number TEXT;
  v_cargo_type cargo_type;
BEGIN
  -- ip_required guard (Phase 9 convention #12)
  IF p_ip IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ip_required');
  END IF;

  -- Pull cargo_type out for category-required-fields validation.
  -- Codex round 1 PR #64 P1 #3 fix — validate the text against
  -- the allowed set BEFORE casting to ENUM. Direct ::cargo_type
  -- cast on a bad value (e.g. 'boat') raises Postgres's raw
  -- "invalid input value for enum cargo_type: ..." error
  -- (sqlstate 22P02), which would surface to the user instead
  -- of our structured contract. Allowlist + cast keeps the
  -- contract clean.
  IF p_payload->>'cargo_type' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_required');
  END IF;
  IF (p_payload->>'cargo_type') NOT IN ('horse', 'luxury_car', 'valuables', 'other') THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_invalid');
  END IF;
  v_cargo_type := (p_payload->>'cargo_type')::cargo_type;

  -- Codex round 4 PR #64 P1 #2 fix — NOT NULL guards on the
  -- 4 required intake fields. The prior draft INSERTed
  -- p_payload->>'customer_name' / 'customer_phone' /
  -- 'pickup_date' / 'estimated_value_sar' directly. If the
  -- payload lacked any of these, the INSERT would hit a NOT
  -- NULL violation (sqlstate 23502) which the existing
  -- check_violation + invalid_text_representation handlers
  -- don't catch — raw PG message would escape to the client.
  -- Explicit guards return structured contract codes per field.
  IF NULLIF(TRIM(p_payload->>'customer_name'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_name_required');
  END IF;
  IF NULLIF(TRIM(p_payload->>'customer_phone'), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'customer_phone_required');
  END IF;
  IF NULLIF(p_payload->>'pickup_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'pickup_date_required');
  END IF;
  IF NULLIF(p_payload->>'estimated_value_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_required');
  END IF;

  -- Other guards (rate limit per IP, etc.) handled by app layer.
  -- DB layer enforces structural integrity via the §3.1
  -- constraints (cargo_requests_identity_check +
  -- cargo_requests_category_required_check +
  -- cargo_requests_*_present_check + value/date sanity).
  -- A failed insert returns a structured error rather than
  -- the raw PG message.

  BEGIN
    INSERT INTO cargo_requests (
      client_id,
      customer_name_snapshot,
      customer_phone_snapshot,
      customer_email_snapshot,
      cargo_type,
      origin_iata, origin_freeform,
      destination_iata, destination_freeform,
      pickup_date, delivery_date_target, flexibility_days,
      estimated_value_sar, insurance_required,
      handling_notes,
      -- horse fields
      horse_count, horse_groom_required,
      horse_cites_status, horse_stall_requirements,
      -- luxury_car fields
      car_make, car_model, car_year,
      car_running_condition, car_enclosed_required,
      -- valuables fields
      valuables_declared_value_sar,
      valuables_security_level,
      valuables_climate_controlled,
      valuables_item_description,
      -- other fields
      other_description,
      other_dimensions_lwh_cm,
      other_weight_kg,
      other_special_handling
    ) VALUES (
      NULL,  -- guest path
      p_payload->>'customer_name',
      p_payload->>'customer_phone',
      p_payload->>'customer_email',  -- nullable
      v_cargo_type,
      NULLIF(p_payload->>'origin_iata', ''),
      NULLIF(p_payload->>'origin_freeform', ''),
      NULLIF(p_payload->>'destination_iata', ''),
      NULLIF(p_payload->>'destination_freeform', ''),
      (p_payload->>'pickup_date')::DATE,
      NULLIF(p_payload->>'delivery_date_target', '')::DATE,
      COALESCE((p_payload->>'flexibility_days')::INT, 0),
      (p_payload->>'estimated_value_sar')::DECIMAL,
      COALESCE((p_payload->>'insurance_required')::BOOLEAN, false),
      NULLIF(p_payload->>'handling_notes', ''),
      -- horse
      NULLIF(p_payload->>'horse_count', '')::INT,
      NULLIF(p_payload->>'horse_groom_required', '')::BOOLEAN,
      NULLIF(p_payload->>'horse_cites_status', ''),
      NULLIF(p_payload->>'horse_stall_requirements', ''),
      -- luxury_car
      NULLIF(p_payload->>'car_make', ''),
      NULLIF(p_payload->>'car_model', ''),
      NULLIF(p_payload->>'car_year', '')::INT,
      NULLIF(p_payload->>'car_running_condition', '')::BOOLEAN,
      NULLIF(p_payload->>'car_enclosed_required', '')::BOOLEAN,
      -- valuables
      NULLIF(p_payload->>'valuables_declared_value_sar', '')::DECIMAL,
      NULLIF(p_payload->>'valuables_security_level', ''),
      NULLIF(p_payload->>'valuables_climate_controlled', '')::BOOLEAN,
      NULLIF(p_payload->>'valuables_item_description', ''),
      -- other
      NULLIF(p_payload->>'other_description', ''),
      NULLIF(p_payload->>'other_dimensions_lwh_cm', ''),
      NULLIF(p_payload->>'other_weight_kg', '')::DECIMAL,
      NULLIF(p_payload->>'other_special_handling', '')
    )
    RETURNING id, cargo_request_number INTO v_request_id, v_request_number;
  EXCEPTION
    WHEN check_violation THEN
      -- Codex round 3 PR #64 P2 #4 fix — disambiguate the new
      -- value/date sanity CHECKs from the existing identity +
      -- category + route CHECKs. Pattern mirrors §4.3
      -- price_invalid disambiguation via GET STACKED DIAGNOSTICS.
      DECLARE
        v_constraint_name TEXT;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name = 'cargo_requests_value_positive_check' THEN
          RETURN json_build_object('ok', false, 'error', 'value_invalid');
        ELSIF v_constraint_name = 'cargo_requests_date_order_check' THEN
          RETURN json_build_object('ok', false, 'error', 'date_invalid');
        END IF;
        -- Default for identity + category + route + flexibility CHECKs
        RETURN json_build_object('ok', false, 'error', 'validation_failed');
      END;
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
  END;

  RETURN json_build_object(
    'ok', true,
    'cargo_request_id', v_request_id,
    'cargo_request_number', v_request_number,
    'created_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION create_cargo_request_guest(JSONB, INET)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_cargo_request_guest(JSONB, INET)
  TO service_role;
```

**Structured contracts:**

| Code | Trigger |
|---|---|
| `ip_required` | Server Action passed null IP |
| `cargo_type_required` | payload missing `cargo_type` |
| `cargo_type_invalid` | `cargo_type` not in allowed set (round 1 P1 #3 fix) |
| `customer_name_required` | payload missing `customer_name` (round 4 P1 #2 fix; §4.1 only — §4.2 reads from clients) |
| `customer_phone_required` | payload missing `customer_phone` (round 4 P1 #2 fix; §4.1 only) |
| `pickup_date_required` | payload missing `pickup_date` (round 4 P1 #2 fix; both §4.1 + §4.2) |
| `estimated_value_required` | payload missing `estimated_value_sar` (round 4 P1 #2 fix; both) |
| `value_invalid` | `estimated_value_sar <= 0` (round 3 P2 #4 fix; via `cargo_requests_value_positive_check`) |
| `date_invalid` | `delivery_date_target < pickup_date` (round 3 P2 #4 fix; via `cargo_requests_date_order_check`) |
| `validation_failed` | Other DB CHECK constraint rejected (identity + category exclusivity + route + flexibility range) |
| `malformed_input` | numeric/date parsing failed |

§4.2 (`create_cargo_request_authenticated`) returns the same
contract set above plus `client_not_found` + `client_not_active`,
**minus** `customer_name_required` + `customer_phone_required`
(those fields are pulled from the clients table, not the
payload, in §4.2).

### §4.2 — `create_cargo_request_authenticated` (NEW)

Authenticated client path. Mirrors §4.1 but populates
`client_id` and pulls customer snapshots from the `clients`
table (NOT from payload — prevents identity spoofing).

```sql
CREATE OR REPLACE FUNCTION create_cargo_request_authenticated(
  p_client_id UUID,
  p_payload JSONB,
  p_ip INET
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_row RECORD;
  v_request_id UUID;
  v_request_number TEXT;
  v_cargo_type cargo_type;
BEGIN
  IF p_ip IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'ip_required');
  END IF;

  SELECT id, full_name, contact_phone, auth_email, signup_status
    INTO v_client_row
    FROM clients
   WHERE id = p_client_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_found');
  END IF;

  IF v_client_row.signup_status <> 'active' THEN
    RETURN json_build_object('ok', false, 'error', 'client_not_active');
  END IF;

  -- Codex round 1 PR #64 P1 #3 fix (mirror of §4.1) — text
  -- allowlist before ENUM cast.
  IF p_payload->>'cargo_type' IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_required');
  END IF;
  IF (p_payload->>'cargo_type') NOT IN ('horse', 'luxury_car', 'valuables', 'other') THEN
    RETURN json_build_object('ok', false, 'error', 'cargo_type_invalid');
  END IF;
  v_cargo_type := (p_payload->>'cargo_type')::cargo_type;

  -- Codex round 4 PR #64 P1 #2 fix (mirror of §4.1) — NOT NULL
  -- guards for the 2 required intake fields not sourced from
  -- the clients table. customer_name + customer_phone are pulled
  -- from v_client_row (always populated for an active client),
  -- so only pickup_date + estimated_value_sar need explicit
  -- payload guards here.
  IF NULLIF(p_payload->>'pickup_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'pickup_date_required');
  END IF;
  IF NULLIF(p_payload->>'estimated_value_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'estimated_value_required');
  END IF;

  BEGIN
    INSERT INTO cargo_requests (
      client_id,
      customer_name_snapshot,
      customer_phone_snapshot,
      customer_email_snapshot,
      cargo_type,
      origin_iata, origin_freeform,
      destination_iata, destination_freeform,
      pickup_date, delivery_date_target, flexibility_days,
      estimated_value_sar, insurance_required,
      handling_notes,
      horse_count, horse_groom_required,
      horse_cites_status, horse_stall_requirements,
      car_make, car_model, car_year,
      car_running_condition, car_enclosed_required,
      valuables_declared_value_sar,
      valuables_security_level,
      valuables_climate_controlled,
      valuables_item_description,
      other_description, other_dimensions_lwh_cm,
      other_weight_kg, other_special_handling
    ) VALUES (
      v_client_row.id,
      v_client_row.full_name,                  -- *DIFF* from clients table
      v_client_row.contact_phone,              -- *DIFF*
      v_client_row.auth_email,                 -- *DIFF*
      v_cargo_type,
      NULLIF(p_payload->>'origin_iata', ''),
      NULLIF(p_payload->>'origin_freeform', ''),
      NULLIF(p_payload->>'destination_iata', ''),
      NULLIF(p_payload->>'destination_freeform', ''),
      (p_payload->>'pickup_date')::DATE,
      NULLIF(p_payload->>'delivery_date_target', '')::DATE,
      COALESCE((p_payload->>'flexibility_days')::INT, 0),
      (p_payload->>'estimated_value_sar')::DECIMAL,
      COALESCE((p_payload->>'insurance_required')::BOOLEAN, false),
      NULLIF(p_payload->>'handling_notes', ''),
      NULLIF(p_payload->>'horse_count', '')::INT,
      NULLIF(p_payload->>'horse_groom_required', '')::BOOLEAN,
      NULLIF(p_payload->>'horse_cites_status', ''),
      NULLIF(p_payload->>'horse_stall_requirements', ''),
      NULLIF(p_payload->>'car_make', ''),
      NULLIF(p_payload->>'car_model', ''),
      NULLIF(p_payload->>'car_year', '')::INT,
      NULLIF(p_payload->>'car_running_condition', '')::BOOLEAN,
      NULLIF(p_payload->>'car_enclosed_required', '')::BOOLEAN,
      NULLIF(p_payload->>'valuables_declared_value_sar', '')::DECIMAL,
      NULLIF(p_payload->>'valuables_security_level', ''),
      NULLIF(p_payload->>'valuables_climate_controlled', '')::BOOLEAN,
      NULLIF(p_payload->>'valuables_item_description', ''),
      NULLIF(p_payload->>'other_description', ''),
      NULLIF(p_payload->>'other_dimensions_lwh_cm', ''),
      NULLIF(p_payload->>'other_weight_kg', '')::DECIMAL,
      NULLIF(p_payload->>'other_special_handling', '')
    )
    RETURNING id, cargo_request_number INTO v_request_id, v_request_number;
  EXCEPTION
    WHEN check_violation THEN
      -- Codex round 3 PR #64 P2 #4 fix (mirror of §4.1) —
      -- value_invalid + date_invalid disambiguation via
      -- GET STACKED DIAGNOSTICS CONSTRAINT_NAME.
      DECLARE
        v_constraint_name TEXT;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name = 'cargo_requests_value_positive_check' THEN
          RETURN json_build_object('ok', false, 'error', 'value_invalid');
        ELSIF v_constraint_name = 'cargo_requests_date_order_check' THEN
          RETURN json_build_object('ok', false, 'error', 'date_invalid');
        END IF;
        RETURN json_build_object('ok', false, 'error', 'validation_failed');
      END;
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
  END;

  RETURN json_build_object(
    'ok', true,
    'cargo_request_id', v_request_id,
    'cargo_request_number', v_request_number,
    'client_id', v_client_row.id,
    'created_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION create_cargo_request_authenticated(UUID, JSONB, INET)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_cargo_request_authenticated(UUID, JSONB, INET)
  TO service_role;
```

### §4.3 — `submit_cargo_offer` (NEW)

Cargo operator submits an offer for a `cargo_request`.

```sql
CREATE OR REPLACE FUNCTION submit_cargo_offer(
  p_operator_id UUID,
  p_cargo_request_id UUID,
  p_payload JSONB
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_op_row RECORD;
  v_req_row RECORD;
  v_offer_id UUID;
  v_aircraft_id UUID;
BEGIN
  -- Load + lock operator. Codex round 1 PR #64 P1 #2 fix —
  -- the Phase 8 operators table column is `company_name`, not
  -- `business_name`. The prior draft would have crashed with
  -- `column "business_name" does not exist` on the first
  -- offer submission.
  SELECT id, company_name, contact_phone, contact_email, signup_status
    INTO v_op_row
    FROM operators
   WHERE id = p_operator_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_found');
  END IF;
  IF v_op_row.signup_status <> 'approved' THEN
    RETURN json_build_object('ok', false, 'error', 'operator_not_approved');
  END IF;

  -- Load + lock request
  SELECT id, status, cargo_type, expires_at
    INTO v_req_row
    FROM cargo_requests
   WHERE id = p_cargo_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;
  IF v_req_row.status NOT IN ('pending', 'offers_received') THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_open');
  END IF;
  IF v_req_row.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'request_expired');
  END IF;

  -- Aircraft capability check (Decision #7 + Codex round 1
  -- PR #64 P1 #4 fix). aircraft_id is now NOT NULL on
  -- cargo_offers (§3.2), so the capability check fires on
  -- EVERY offer submission — no more bypass via omitted
  -- aircraft_id.
  --
  -- Codex round 2 PR #64 P1 #1 fix — UUID cast in its own
  -- BEGIN/EXCEPTION block. The prior draft handled the
  -- empty/missing case (NULLIF returns NULL → structured
  -- aircraft_id_required), but a non-empty malformed value
  -- like 'not-a-uuid' would raise raw 22P02
  -- "invalid input syntax for type uuid" instead of the
  -- structured contract. Wrap the cast in BEGIN/EXCEPTION
  -- so the structured aircraft_id_invalid error covers
  -- both malformed text + the rare cases where the cast
  -- otherwise leaks.
  IF p_payload->>'aircraft_id' IS NULL
     OR p_payload->>'aircraft_id' = '' THEN
    RETURN json_build_object('ok', false, 'error', 'aircraft_id_required');
  END IF;

  BEGIN
    v_aircraft_id := (p_payload->>'aircraft_id')::UUID;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'aircraft_id_invalid');
  END;

  PERFORM 1 FROM cargo_aircraft_capabilities cac
    JOIN aircraft a ON a.id = cac.aircraft_id
   WHERE cac.aircraft_id = v_aircraft_id
     AND a.operator_id = p_operator_id
     AND CASE v_req_row.cargo_type
           WHEN 'horse'       THEN cac.supports_horse
           WHEN 'luxury_car'  THEN cac.supports_luxury_car
           WHEN 'valuables'   THEN cac.supports_valuables
           WHEN 'other'       THEN cac.supports_other
         END;
  IF NOT FOUND THEN
    -- One of three cases:
    --  1. aircraft_id doesn't belong to this operator
    --  2. aircraft_id has no row in cargo_aircraft_capabilities
    --  3. aircraft has the row but the cargo_type-specific
    --     supports_* flag is false
    -- All three collapse to one opaque error to avoid
    -- leaking which aircraft the operator owns or which
    -- capabilities are seeded.
    RETURN json_build_object('ok', false, 'error', 'aircraft_not_capable');
  END IF;

  -- Codex round 4 PR #64 P1 #3 fix — NOT NULL guards on the
  -- 3 required offer fields. The prior draft INSERTed
  -- (p_payload->>'base_price_sar')::DECIMAL etc. directly. If
  -- the payload lacked any of these, the INSERT would hit a
  -- NOT NULL violation (sqlstate 23502) which the existing
  -- check_violation + invalid_text_representation handlers
  -- don't catch — raw PG message would escape to the operator.
  -- Explicit guards return structured contract codes per field.
  -- (insurance_price_sar + customs_handling_price_sar default
  -- to 0 via COALESCE in the VALUES list below; their omission
  -- is intentional + safe.)
  IF NULLIF(p_payload->>'base_price_sar', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'base_price_required');
  END IF;
  IF NULLIF(p_payload->>'proposed_pickup_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_pickup_date_required');
  END IF;
  IF NULLIF(p_payload->>'proposed_delivery_date', '') IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'proposed_delivery_date_required');
  END IF;

  BEGIN
    INSERT INTO cargo_offers (
      cargo_request_id, operator_id, aircraft_id,
      operator_name_snapshot, operator_phone_snapshot,
      operator_email_snapshot, aircraft_snapshot,
      base_price_sar, insurance_price_sar, customs_handling_price_sar,
      proposed_pickup_date, proposed_delivery_date,
      operator_notes
    ) VALUES (
      p_cargo_request_id, p_operator_id, v_aircraft_id,
      v_op_row.company_name, v_op_row.contact_phone, v_op_row.contact_email,
      NULLIF(p_payload->>'aircraft_snapshot', ''),
      (p_payload->>'base_price_sar')::DECIMAL,
      COALESCE((p_payload->>'insurance_price_sar')::DECIMAL, 0),
      COALESCE((p_payload->>'customs_handling_price_sar')::DECIMAL, 0),
      (p_payload->>'proposed_pickup_date')::DATE,
      (p_payload->>'proposed_delivery_date')::DATE,
      NULLIF(p_payload->>'operator_notes', '')
    )
    RETURNING id INTO v_offer_id;
  EXCEPTION
    WHEN check_violation THEN
      -- Codex round 2 PR #64 P1 #2 fix — disambiguate price
      -- CHECKs from the date-order CHECK using GET STACKED
      -- DIAGNOSTICS. SQLERRM substring matching is fragile
      -- (PG message text varies by locale + version);
      -- CONSTRAINT_NAME is the canonical contract.
      DECLARE
        v_constraint_name TEXT;
      BEGIN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IN (
          'cargo_offers_base_price_positive_check',
          'cargo_offers_insurance_price_nonneg_check',
          'cargo_offers_customs_handling_nonneg_check'
        ) THEN
          RETURN json_build_object('ok', false, 'error', 'price_invalid');
        END IF;
        -- Default for cargo_offers_date_order_check + any
        -- other future CHECK constraints we add.
        RETURN json_build_object('ok', false, 'error', 'validation_failed');
      END;
    WHEN invalid_text_representation THEN
      RETURN json_build_object('ok', false, 'error', 'malformed_input');
  END;

  -- Flip request status to 'offers_received' if it was 'pending'
  UPDATE cargo_requests
     SET status = 'offers_received',
         updated_at = NOW()
   WHERE id = p_cargo_request_id
     AND status = 'pending';

  RETURN json_build_object(
    'ok', true,
    'offer_id', v_offer_id,
    'cargo_request_id', p_cargo_request_id,
    'operator_id', p_operator_id
  );
END;
$$;

REVOKE ALL ON FUNCTION submit_cargo_offer(UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_cargo_offer(UUID, UUID, JSONB)
  TO service_role;
```

**Structured contracts:**

| Code | Trigger |
|---|---|
| `operator_not_found` | `p_operator_id` invalid |
| `operator_not_approved` | `operators.signup_status` != 'approved' |
| `request_not_found` | `p_cargo_request_id` invalid |
| `request_not_open` | request status not in {pending, offers_received} |
| `request_expired` | request `expires_at` elapsed |
| `aircraft_id_required` | payload missing `aircraft_id` (round 1 P1 #4 fix) |
| `aircraft_id_invalid` | `aircraft_id` value is not a valid UUID shape (round 2 P1 #1 fix — catches raw 22P02) |
| `aircraft_not_capable` | aircraft owned by different operator OR no `cargo_aircraft_capabilities` row OR cargo-type-specific flag false |
| `base_price_required` | payload missing `base_price_sar` (round 4 P1 #3 fix) |
| `proposed_pickup_date_required` | payload missing `proposed_pickup_date` (round 4 P1 #3 fix) |
| `proposed_delivery_date_required` | payload missing `proposed_delivery_date` (round 4 P1 #3 fix) |
| `price_invalid` | base_price ≤ 0 OR insurance/customs price < 0 (round 2 P1 #2 fix; disambiguated from generic validation_failed via GET STACKED DIAGNOSTICS CONSTRAINT_NAME match on the 3 named price CHECKs) |
| `validation_failed` | DB CHECK constraint rejected (e.g. `cargo_offers_date_order_check` — proposed_delivery_date < proposed_pickup_date) |
| `malformed_input` | numeric/date parsing failed |

### §4.4 — `accept_cargo_offer` (NEW)

Branches on guest vs authed path. Accepts an offer →
creates a `bookings` row with `source_discriminator='cargo'`.

```sql
CREATE OR REPLACE FUNCTION accept_cargo_offer(
  p_offer_id UUID,
  p_actor_client_id UUID,        -- NULL for guest path; set for authed
  p_actor_admin_user_id UUID     -- NULL for client path; set for admin guest acceptance
) RETURNS JSON
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_offer cargo_offers%ROWTYPE;
  v_request cargo_requests%ROWTYPE;
  v_booking_id UUID;
  v_request_id_for_lock UUID;
BEGIN
  -- Codex round 4 PR #64 P2 #4 fix — actor authorization guard.
  -- The signature documents `p_actor_admin_user_id` as set for
  -- admin acceptance, but the body only branched on
  -- p_actor_client_id IS NULL → admin path without checking
  -- p_actor_admin_user_id. A buggy/forged Server Action that
  -- passed both NULL would silently take the admin branch
  -- without any actor identity. Reject the all-NULL case at
  -- the DB boundary (defense-in-depth — Server Action layer
  -- is the primary auth gate, but DB layer should not accept
  -- anonymous accept_cargo_offer calls even via service-role).
  IF p_actor_client_id IS NULL AND p_actor_admin_user_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'actor_required');
  END IF;

  -- Codex round 4 PR #64 P1 #1 fix — deadlock-safe lock order.
  -- The prior draft locked the offer first, then the request,
  -- then declined sibling offers. Two concurrent accepts on
  -- DIFFERENT offers for the SAME request would deadlock:
  --   tx A: locks offer A → locks request → tries to update offer B (waits for B)
  --   tx B: locks offer B → tries to lock request (waits for A)
  --   → deadlock detected by PG, one tx aborted with 40P01
  --
  -- Fix: deterministic lock order. Read the cargo_request_id
  -- from the offer WITHOUT a lock (cheap index lookup), then:
  --   1. Lock the parent request first (single shared resource
  --      across all concurrent accepts on this request)
  --   2. Lock all offers on the request in id-ORDER (consistent
  --      across transactions; PG's per-row lock acquisition
  --      respects the order of the FOR UPDATE rows seen by the
  --      query plan, and the ORDER BY ensures both txs see the
  --      same order)
  -- Because both txs now acquire the request lock first, only
  -- one can proceed past step 1; the second waits for the first
  -- to commit, then sees the post-state (status='accepted' on
  -- the winning offer + status='declined' on its own offer).
  SELECT cargo_request_id INTO v_request_id_for_lock
    FROM cargo_offers WHERE id = p_offer_id;
  IF v_request_id_for_lock IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  -- Step 1: lock the parent request FIRST (deadlock-safe).
  SELECT * INTO v_request FROM cargo_requests
    WHERE id = v_request_id_for_lock FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  -- Step 2: lock the target offer + all sibling offers in
  -- deterministic id-ORDER. Even if 3 concurrent txs target
  -- 3 different offers on the same request, all 3 see the
  -- same lock-acquisition order so no cycle can form.
  -- The tx that wins step 1 acquires all offer locks here; the
  -- losing txs wait for the winner to commit, then re-evaluate
  -- and see status='declined' on their target → return
  -- offer_not_pending without writing anything.
  PERFORM 1 FROM cargo_offers
    WHERE cargo_request_id = v_request_id_for_lock
    ORDER BY id
    FOR UPDATE;

  -- Step 3: re-load the target offer post-lock for state
  -- inspection. Use SELECT (not the PERFORM above) to capture
  -- the row into v_offer.
  SELECT * INTO v_offer FROM cargo_offers
    WHERE id = p_offer_id;
  IF NOT FOUND THEN
    -- Race: offer deleted between step 1 and step 2 (very
    -- unlikely with the §3.3 ON DELETE RESTRICT FK invariant,
    -- but defensive).
    RETURN json_build_object('ok', false, 'error', 'offer_not_found');
  END IF;

  -- State guards
  IF v_offer.status <> 'pending' THEN
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending');
  END IF;
  IF v_offer.expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'offer_expired');
  END IF;
  IF v_request.status NOT IN ('pending', 'offers_received') THEN
    RETURN json_build_object('ok', false, 'error', 'request_not_open');
  END IF;
  IF v_request.expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'request_expired');
  END IF;

  -- Authorization: client path must own the request; admin
  -- path can accept any guest request.
  IF p_actor_client_id IS NOT NULL THEN
    IF v_request.client_id IS DISTINCT FROM p_actor_client_id THEN
      RETURN json_build_object('ok', false, 'error', 'not_your_request');
    END IF;
  ELSE
    -- Admin path: request MUST be a guest one
    IF v_request.client_id IS NOT NULL THEN
      RETURN json_build_object('ok', false, 'error', 'admin_cannot_accept_for_authed_client');
    END IF;
  END IF;

  -- Create booking (column shape matches Phase 6/9 + Phase 10
  -- §4.3 patterns; source_discriminator = 'cargo')
  INSERT INTO bookings (
    offer_id, trip_request_id,
    route_origin_iata, route_destination_iata,
    route_origin_freeform_snapshot, route_destination_freeform_snapshot,
    passengers_count_snapshot, return_scheduled,
    source_offer_table, source_offer_id,
    source_discriminator,
    client_id,
    customer_name_snapshot, customer_phone_snapshot,
    operator_id,
    operator_name_snapshot, operator_phone_snapshot, operator_email_snapshot,
    aircraft_id, aircraft_snapshot,
    base_amount, addons_amount, vat_amount, total_amount,
    commission_amount, operator_payout,
    payment_status, flight_status,
    departure_scheduled,
    checkout_token_hash, checkout_token_expires_at
  ) VALUES (
    NULL, NULL,
    v_request.origin_iata, v_request.destination_iata,
    v_request.origin_freeform, v_request.destination_freeform,
    NULL,                                              -- passengers N/A for cargo
    NULL,                                              -- return_scheduled N/A
    'cargo_offers',                                    -- source_offer_table
    v_offer.id,                                        -- source_offer_id
    'cargo',                                           -- *DIFF* source_discriminator
    v_request.client_id,                               -- nullable for guest
    v_request.customer_name_snapshot,                  -- already populated for both paths
    v_request.customer_phone_snapshot,
    v_offer.operator_id,
    v_offer.operator_name_snapshot,
    v_offer.operator_phone_snapshot,
    v_offer.operator_email_snapshot,
    v_offer.aircraft_id,
    v_offer.aircraft_snapshot,
    v_offer.base_price_sar,                            -- base_amount
    v_offer.insurance_price_sar + v_offer.customs_handling_price_sar,  -- addons_amount
    NULL,                                              -- vat_amount (Phase 14)
    v_offer.total_price_sar,                           -- total_amount
    NULL, NULL,                                        -- commission/payout (Phase 14)
    'pending_offline'::booking_payment_status,
    'confirmed'::booking_flight_status,
    v_offer.proposed_pickup_date::TIMESTAMPTZ,         -- departure_scheduled
    NULL, NULL                                         -- checkout token (Phase 14)
  )
  RETURNING id INTO v_booking_id;

  -- Flip offer + request statuses
  UPDATE cargo_offers
     SET status = 'accepted',
         decided_at = v_now,
         decided_by_user_id = p_actor_client_id,
         updated_at = v_now
   WHERE id = p_offer_id;

  UPDATE cargo_requests
     SET status = 'accepted',
         accepted_offer_id = p_offer_id,
         updated_at = v_now
   WHERE id = v_request.id;

  -- Decline all other pending offers on the same request
  UPDATE cargo_offers
     SET status = 'declined',
         decided_at = v_now,
         decided_by_user_id = p_actor_client_id,
         updated_at = v_now
   WHERE cargo_request_id = v_request.id
     AND id <> p_offer_id
     AND status = 'pending';

  -- Audit log (mirrors Phase 10 §4.3 round 3 P1 #1 pattern —
  -- audit_logs.user_id is FK to users(id); admins don't have
  -- a users row so user_id=NULL + admin id stashed in new_value)
  INSERT INTO audit_logs (
    entity_type, entity_id, action, new_value, user_id
  ) VALUES (
    'booking', v_booking_id, 'cargo_offer_accepted',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'cargo_request_id', v_request.id,
      'actor_client_id', p_actor_client_id,
      'actor_admin_user_id', p_actor_admin_user_id,
      'accepted_at', v_now
    ),
    NULL
  );

  RETURN json_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'offer_id', p_offer_id,
    'cargo_request_id', v_request.id,
    'accepted_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_cargo_offer(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION accept_cargo_offer(UUID, UUID, UUID)
  TO service_role;
```

**Structured contracts:**

| Code | Trigger |
|---|---|
| `actor_required` | Both `p_actor_client_id` AND `p_actor_admin_user_id` are NULL (round 4 P2 #4 fix; defense-in-depth — Server Action layer is primary auth gate) |
| `offer_not_found` | `p_offer_id` invalid OR offer deleted post-lock (rare) |
| `request_not_found` | `cargo_offers.cargo_request_id` references missing request (only possible if FK violated; defensive) |
| `offer_not_pending` | `cargo_offers.status` not 'pending' (already accepted/declined/withdrawn/expired by another actor) |
| `offer_expired` | `cargo_offers.expires_at` elapsed |
| `request_not_open` | `cargo_requests.status` not in {'pending', 'offers_received'} |
| `request_expired` | `cargo_requests.expires_at` elapsed |
| `not_your_request` | Client actor's `id` doesn't match `cargo_requests.client_id` |
| `admin_cannot_accept_for_authed_client` | Admin path on a request whose `client_id IS NOT NULL` (admin only authorized for guest requests) |

### §4.5 — `decline_cargo_offer` + `withdraw_cargo_offer` (NEW)

Pair of mirror RPCs for client/admin decline + operator
withdraw. Bodies follow the same lock-then-update pattern.
Full SQL deferred to PR 2 implementation; this section
documents the contracts:

| RPC | Caller | Required guards |
|---|---|---|
| `decline_cargo_offer(p_offer_id, p_actor_client_id, p_actor_admin_user_id, p_reason)` | Client (authed) or admin (guest path) | offer.status='pending', actor matches request.client_id (authed) OR request.client_id IS NULL (admin) |
| `withdraw_cargo_offer(p_offer_id, p_operator_id, p_reason)` | Operator | offer.status='pending', offer.operator_id=p_operator_id |

Both flip `cargo_offers.status` to `declined` / `withdrawn`
+ set `decided_at` + log to `audit_logs`. They do NOT change
`cargo_requests.status` (request stays open for other
offers). PR 2 ships these RPCs.

### §4.6 — `cancel_cargo_request` (NEW)

Client or admin cancels the entire request before any offer
is accepted. Cascades to declining all pending offers.
Full SQL deferred to PR 2.

```
cancel_cargo_request(p_request_id, p_actor_client_id, p_actor_admin_user_id, p_reason)
```

---

## 5. PR breakdown

### PR 1 — Backend + public form + admin intake (~1500 lines total)

**Migration** `20260518000030_phase_11_pr_1_cargo_intake.sql`:
- §3.1 cargo_requests table + 2 ENUMs (cargo_type +
  cargo_request_status, both wrapped in pg_type DO block
  guards per round 1 P2 #5) + 3 named CHECK constraints +
  3 indexes
- §3.2 cargo_offers table + 1 ENUM (cargo_offer_status, same
  DO block guard) + 3 named price CHECK constraints (round 2
  P1 #2) + 3 indexes (table created so §3.3 can FK back)
- §3.3 cargo_requests.accepted_offer_id FK (replay-safe DO
  block) with `ON DELETE RESTRICT` (round 2 P2 #3) +
  cargo_requests_accepted_has_offer_check invariant CHECK
  (round 2 P2 #3 defense-in-depth)
- §3.4.1 bookings.source_discriminator CHECK extended to
  include 'cargo'
- §3.4.2 bookings_source_offer_check extended to include
  'cargo_offers' (Codex round 1 P1 #1 fix — without this
  the first cargo accept fails at INSERT with
  check_violation; the prior round 0 manifest erroneously
  omitted this from PR 1's scope)
- §3.5 cargo_aircraft_capabilities table + 4 partial indexes
  + at-least-one CHECK
- §3.6 cargo_email_alert_status singleton + RLS
- §4.1 create_cargo_request_guest RPC
- §4.2 create_cargo_request_authenticated RPC
- §4.3 submit_cargo_offer RPC
- REVOKE/GRANT for all 3 RPCs

**TS pipeline:**
- `lib/cargo/types.ts` — re-exports cargo_* types from database.ts
- `lib/cargo/validators/cargo-request.ts` — Zod schemas per cargo_type
- `lib/cargo/queries/admin-queue.ts` — list pending requests for admin
- `types/database.ts` — extend with CargoRequestRow + CargoOfferRow + CargoAircraftCapabilityRow + CargoEmailAlertStatusRow + table registrations + extended BookingRow.source_discriminator type

**Server Actions** (`app/actions/cargo-public.ts`):
- `submitCargoRequestPublic` — wraps §4.1 RPC

**Public page** (`app/(public)/cargo/page.tsx` + form):
- Cargo type selector (4 options)
- Per-category conditional fields
- Public submit + confirmation page with CGO-XXXX number

**Admin pages:**
- `/admin/cargo` — list pending + offers_received requests
- `/admin/cargo/[id]` — detail + offer history (read-only in PR 1)
- `/admin/cargo/aircraft-capabilities` — seed/edit per-aircraft capability matrix

**i18n** (new file `lib/i18n/cargo-ar.ts`):
- Cargo type labels + per-category form field labels + status chips + error contracts

**Tests:**
- `lib/cargo/__tests__/cargo-request-validators.test.ts` — Zod per-category coverage (4 cargo types × 3 cases each = 12 tests)

### PR 2 — Authed portal + offer/booking integration (~1200 lines)

**Migration** `20260519000031_phase_11_pr_2_cargo_offers_booking.sql`:
- §4.4 accept_cargo_offer RPC
- §4.5 decline_cargo_offer + withdraw_cargo_offer RPCs
- §4.6 cancel_cargo_request RPC

**Server Actions** (`app/actions/cargo-clients.ts` + `cargo-operators.ts`):
- `submitCargoRequestAuthed` — wraps §4.2
- `acceptMyCargoOffer` — wraps §4.4 (client path)
- `declineMyCargoOffer` — wraps §4.5
- `cancelMyCargoRequest` — wraps §4.6
- `submitCargoOffer` — wraps §4.3 (operator path; called from operator portal)
- `withdrawMyCargoOffer` — wraps §4.5

**Authed pages:**
- `/me/cargo-requests` — list client's requests (mirror of /me/requests)
- `/me/cargo-requests/new` — form (re-uses public form component with pre-filled fields)
- `/me/cargo-requests/[id]` — detail + offer table + accept/decline buttons

**Bookings unification extension:**
- `BookingsSourceChip` extended to 3 values: `'charter'` | `'empty_leg'` | `'cargo'` — adds new "شحن" chip with distinct color (e.g., emerald)
- `/me/bookings` automatically surfaces cargo bookings (no page change — Decision #10 carries forward)

**Operator portal extension:**
- `/operator/cargo` — list cargo requests dispatched to operator
- `/operator/cargo/[id]/offer` — submit offer form
- `/operator/cargo/offers` — list operator's submitted offers + status

**Admin extension:**
- `/admin/cargo/[id]` adds accept-offer + decline-offer buttons (admin path for guest requests)

**Tests:**
- `lib/cargo/__tests__/accept-flow.test.ts` — 5 cases (guest accept, authed accept, expired, not-pending, ownership)
- `lib/cargo/__tests__/booking-shape.test.ts` — verify booking column shape matches Phase 6/9 pattern

### PR 3 — Distribution engine + ops polish (~800 lines)

**Migration** `20260520000032_phase_11_pr_3_cargo_distribution.sql`:
- New `cargo_dispatch_events_outbox` table (mirror of empty_leg_events_outbox)
- Trigger on cargo_requests INSERT to write outbox event

**TS pipeline:**
- `lib/cargo/distribution.ts` — eligible operator scoring (capability match + last-dispatched recency + operator rating)
- `lib/cargo/notifications.ts` — operator email/wa.me builders
- `lib/cargo/founder-batch-email.ts` — admin alert when N+ operators dispatched

**Cron route:**
- `/api/cron/cargo/dispatch-drain` — periodic outbox drain (schedule: */15 * * * *)

**Admin extensions:**
- 6th `<ChannelHealth>` card on `/admin/operators/canary` — reads §3.6 singleton
- `/admin/cargo/[id]/distribute` — manual dispatch button (overrides auto)

**Observability:**
- Per-operator `cargo_dispatch_count_24h` metric exposed via canary
- Per-client submission rate alert (Decision #10)

**Founder probes (28-32):**
- 28 — schema state (10+ checks)
- 29 — guest cargo request → admin sees in queue
- 30 — authed cargo request → /me/cargo-requests shows it
- 31 — operator submits offer → client/admin sees → accept → booking with source_discriminator='cargo' → /me/bookings chip "شحن"
- 32 — distribution engine (eligible operator filter via cargo_aircraft_capabilities)

---

## 6. Founder probes

5 probes for Phase 11 (probes 28-32; numbering continues
from Phase 10's 21-27). Each probe is end-to-end executable
from Supabase SQL Editor + the live deployment, mirroring
the Phase 10 PR 2 runbook discipline.

### Probe 28 — Schema state (PR 1, before flag flip)

```sql
SELECT
  -- New tables
  EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cargo_requests') AS has_cargo_requests,
  EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cargo_offers') AS has_cargo_offers,
  EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cargo_aircraft_capabilities') AS has_capabilities,
  EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cargo_email_alert_status') AS has_alert_singleton,
  -- Singleton seeded healthy
  EXISTS (SELECT 1 FROM cargo_email_alert_status
    WHERE id = 1 AND status = 'healthy') AS singleton_healthy,
  -- §3.4.1 Extended bookings.source_discriminator CHECK
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_source_discriminator_check'
      AND conrelid = 'bookings'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%cargo%') AS source_disc_check_extended,
  -- §3.4.2 Extended bookings.source_offer_check (Codex round 1
  -- P1 #1 fix). Without this check the first cargo offer accept
  -- would fail with check_violation at INSERT time.
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_source_offer_check'
      AND conrelid = 'bookings'::regclass
      AND pg_get_constraintdef(oid) ILIKE '%cargo_offers%') AS source_offer_check_extended,
  -- ENUMs exist (created via DO block guards per round 1 P2 #5)
  EXISTS (SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cargo_type'
      AND n.nspname = 'public') AS has_cargo_type_enum,
  EXISTS (SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cargo_request_status'
      AND n.nspname = 'public') AS has_request_status_enum,
  EXISTS (SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cargo_offer_status'
      AND n.nspname = 'public') AS has_offer_status_enum,
  -- accepted_offer_id FK exists with RESTRICT action
  -- (Codex round 2 P2 #3 fix; was SET NULL → could orphan
  -- accepted requests). confdeltype = 'r' means RESTRICT.
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'cargo_requests_accepted_offer_fkey'
      AND conrelid = 'cargo_requests'::regclass
      AND confdeltype = 'r') AS accepted_offer_fk_restrict,
  -- §3.3 invariant CHECK: accepted requests must have a non-
  -- NULL accepted_offer_id (defense-in-depth alongside FK)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'cargo_requests_accepted_has_offer_check'
      AND conrelid = 'cargo_requests'::regclass) AS accepted_has_offer_check,
  -- §3.2 cargo_offers.aircraft_id NOT NULL (round 1 P1 #4 fix)
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cargo_offers'
      AND column_name = 'aircraft_id'
      AND is_nullable = 'NO') AS aircraft_id_not_null,
  -- §3.2 cargo_offers price CHECKs (Codex round 2 P1 #2 fix —
  -- 3 named CHECKs for price validity + structured price_invalid
  -- error contract via GET STACKED DIAGNOSTICS in §4.3)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'cargo_offers_base_price_positive_check'
      AND conrelid = 'cargo_offers'::regclass) AS has_base_price_positive_check,
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'cargo_offers_insurance_price_nonneg_check'
      AND conrelid = 'cargo_offers'::regclass) AS has_insurance_nonneg_check,
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'cargo_offers_customs_handling_nonneg_check'
      AND conrelid = 'cargo_offers'::regclass) AS has_customs_nonneg_check,
  -- §3.1 request sanity CHECKs (Codex round 3 P2 #4 fix —
  -- mirror the offer-level price/date guards on the intake table)
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'cargo_requests_value_positive_check'
      AND conrelid = 'cargo_requests'::regclass) AS has_request_value_check,
  EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'cargo_requests_date_order_check'
      AND conrelid = 'cargo_requests'::regclass) AS has_request_date_order_check,
  -- §3.2 widened operator snapshot widths (Codex round 3 P1 #1 fix)
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cargo_offers'
      AND column_name = 'operator_name_snapshot'
      AND character_maximum_length = 200) AS operator_name_snapshot_width_200,
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cargo_offers'
      AND column_name = 'operator_email_snapshot'
      AND character_maximum_length = 255) AS operator_email_snapshot_width_255;
```

**Expected:** all 20 = `true` (extended from 16 → 20 in
Codex round 3 P1 #1 + P2 #4 fixes:
- `has_request_value_check` (§3.1 estimated_value > 0)
- `has_request_date_order_check` (§3.1 delivery >= pickup)
- `operator_name_snapshot_width_200` (§3.2 widened from 120)
- `operator_email_snapshot_width_255` (§3.2 widened from 120)).

### Probe 29 — Guest cargo request appears in admin queue

1. Visit `aeris-flax.vercel.app/cargo` (anonymous browser).
2. Submit a horse cargo request (origin RUH, destination JED,
   pickup +14 days, 2 horses, value 250000 SAR).
3. Verify confirmation page shows `CGO-XXXX` reference.
4. SQL verify:
```sql
SELECT cargo_request_number, cargo_type, customer_name_snapshot,
       horse_count, status, client_id
FROM cargo_requests
ORDER BY created_at DESC LIMIT 1;
```
**Expected:** `client_id IS NULL`, `cargo_type='horse'`,
`status='pending'`, `horse_count=2`, snapshots populated.

### Probe 30 — Authed cargo request shows in /me/cargo-requests

(Same as 29 but logged in; verify `client_id` populated +
appears in `/me/cargo-requests` list.)

### Probe 31 — Offer → accept → booking with source chip

1. Operator submits offer via SQL (or PR 2 operator UI):
```sql
SELECT submit_cargo_offer(
  '<operator_id>',
  '<cargo_request_id>',
  jsonb_build_object(
    'aircraft_id', '<capable-aircraft-id>',
    'base_price_sar', 280000,
    'insurance_price_sar', 15000,
    'customs_handling_price_sar', 5000,
    'proposed_pickup_date', '<date>',
    'proposed_delivery_date', '<date+1>'
  )
);
```
2. Client accepts via `/me/cargo-requests/[id]` → "اقبل العرض".
3. SQL verify:
```sql
SELECT booking_number, source_discriminator, total_amount,
       customer_name_snapshot
FROM bookings
WHERE source_offer_table = 'cargo_offers'
ORDER BY created_at DESC LIMIT 1;
```
**Expected:** `source_discriminator='cargo'`, `total_amount=300000`.
4. Visit `/me/bookings` → row appears with chip **"شحن"**.

### Probe 32 — Distribution filters by capability

(PR 3 only.) Pre-condition: 2 cargo operators, only 1 has
horse capability seeded.

Submit horse cargo request. Trigger
`/api/cron/cargo/dispatch-drain`. Verify only the horse-capable
operator received the dispatch (via `cargo_dispatch_events_outbox`
or WhatsApp link audit).

---

## 7. Acceptance + activation runbook

### Codex review checkpoint
- [ ] Spec PR reaches Codex 100/100 (this document)
- [ ] PR 1 reaches Codex 100/100 (backend + public form + admin)
- [ ] PR 2 reaches Codex 100/100 (authed + offer/booking)
- [ ] PR 3 reaches Codex 100/100 (distribution + ops)

### Production activation
1. Apply PR 1 migration. Run probes 28+29.
2. Set `ENABLE_CARGO=false` initially. Public `/cargo` route 404s.
3. After PR 1 + PR 2 deploy: flip `ENABLE_CARGO=true` →
   redeploy. Run probes 29-31.
4. After PR 3 deploy: run probe 32.
5. After 7 days production health: Phase 11 closure ceremony.

---

## Open questions for Codex round 6

Rounds 1-4 closed 10 P1 + 7 P2:

- **Round 1:**
  - **P1 #1:** §3.4 extends BOTH constraints
    (source_discriminator + source_offer_check).
  - **P1 #2:** §4.3 reads `operators.company_name`.
  - **P1 #3:** §4.1 + §4.2 text allowlist before ENUM cast.
  - **P1 #4:** §3.2 aircraft_id NOT NULL + capability check
    unconditional.
  - **P2 #5:** All 3 CREATE TYPE in pg_type DO block guards.
- **Round 2:**
  - **P1 #1:** §4.3 UUID cast in BEGIN/EXCEPTION block →
    structured `aircraft_id_invalid` (catches malformed
    text values like `'not-a-uuid'`; raw 22P02 no longer
    escapes).
  - **P1 #2:** §3.2 3 named price CHECKs
    (`cargo_offers_base_price_positive_check`,
    `cargo_offers_insurance_price_nonneg_check`,
    `cargo_offers_customs_handling_nonneg_check`) +
    §4.3 uses `GET STACKED DIAGNOSTICS CONSTRAINT_NAME`
    (NOT SQLERRM substring — that's locale + version
    fragile) to disambiguate price violations from the
    date-order check, returning `price_invalid` for the
    former and `validation_failed` for the latter.
  - **P2 #3:** §3.3 FK uses `ON DELETE RESTRICT` (was SET
    NULL) + new invariant CHECK
    `cargo_requests_accepted_has_offer_check` (defense-in-
    depth: even if FK is later weakened,
    `status='accepted'` rows must keep their offer pointer).
  - **P2 #4:** §5 PR 1 manifest now lists §3.4.2 + §3.3
    invariant + the 3 named price CHECKs explicitly.
- **Round 3:**
  - **P1 #1:** §3.2 `operator_name_snapshot` widened
    `VARCHAR(120)` → `VARCHAR(200)` + `operator_email_snapshot`
    `VARCHAR(120)` → `VARCHAR(255)` to match source operators
    schema. Prior widths would have rejected legitimate
    approved operators with `value too long`.
  - **P2 #2:** Every `CREATE TABLE` + `CREATE INDEX` (4 tables
    + 11 indexes total in PR 1's migration) now uses
    `IF NOT EXISTS`. Complements round 1 ENUM DO block guards
    so the entire migration is replay-safe end to end.
  - **P2 #3:** §3.1 `cargo_requests_category_required_check`
    extended from "min required for current category" to
    "min required + ALL OTHER 3 categories' fields are NULL".
    Eliminates ambiguous cross-category state where a
    horse request could carry car_make + valuables_security_level
    populated alongside.
  - **P2 #4:** §3.1 added `cargo_requests_value_positive_check`
    (`estimated_value_sar > 0`) + `cargo_requests_date_order_check`
    (`delivery_date_target IS NULL OR delivery_date_target >= pickup_date`)
    + §4.1 + §4.2 disambiguate via GET STACKED DIAGNOSTICS
    CONSTRAINT_NAME → structured `value_invalid` + `date_invalid`
    contracts (mirror of §4.3 price_invalid pattern).
- **Round 4:**
  - **P1 #1:** §4.4 deadlock-safe lock order. Prior order
    (lock offer → lock request → update siblings) deadlocked
    on concurrent accepts targeting different offers on the
    same request (ABBA cycle). New order: read
    cargo_request_id from offer (no lock) → lock parent
    request FIRST → lock all sibling offers ORDER BY id.
    Both concurrent accepts now compete for the request
    lock first; only one passes, the other waits + sees
    post-state (status='declined' on its target).
  - **P1 #2:** §4.1 + §4.2 explicit NOT NULL guards on
    customer_name + customer_phone + pickup_date +
    estimated_value_sar (§4.2 only the latter two — the
    customer fields come from the clients table). Returns
    structured `*_required` contracts instead of raw 23502
    not_null_violation escape.
  - **P1 #3:** §4.3 explicit NOT NULL guards on
    base_price_sar + proposed_pickup_date +
    proposed_delivery_date. Returns structured
    `base_price_required` + `proposed_pickup_date_required` +
    `proposed_delivery_date_required` contracts. (The two
    addon prices stay COALESCE-defaulted to 0; their
    omission is intentional.)
  - **P2 #4:** §4.4 `actor_required` guard rejects the case
    where both `p_actor_client_id` AND `p_actor_admin_user_id`
    are NULL. Defense-in-depth — Server Action layer is the
    primary auth gate (cookie + ADMIN_INBOX_PASSWORD), but
    the DB boundary should never accept anonymous accept
    calls even via service-role.

Three open questions carry forward (unchanged from round 1):

1. **Snapshot freshness on cargo_requests.** Should
   `customer_*_snapshot` re-sync from `clients` table on
   subsequent edits to the request? Phase 9 PR 2 fixed
   snapshots at insert time (Decision #4). Cargo follows
   the same — open if Codex disagrees.
2. **cargo_offer expiry default.** 7 days is suggested in
   §3.2; Phase 9 offers are 24h. Cargo is bespoke +
   higher-value; operators may need longer to quote.
   Codex to validate.
3. **Per-aircraft vs per-operator capability flags.** §3.5
   keys on `aircraft_id`. Alternative: per-operator flags
   (operator says "we can handle horses" without listing
   specific aircraft). Aircraft-level is more precise but
   higher friction to seed; operator-level is simpler but
   lossy. Founder open to either; defaulting to aircraft-
   level for v1.

---

**Spec ready for Codex round 5 review.**
