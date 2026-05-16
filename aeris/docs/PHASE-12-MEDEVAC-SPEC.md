# Phase 12 — Aeris MedEvac (Medical Evacuation + Aeris Shield)

> **Status:** Draft (round 0). Awaiting Codex review.
> **Scope:** Medical evacuation flights (single-event) + Aeris Shield
> subscription tier + medical operator certification matrix +
> per-severity SLA dispatch + insurance snapshot.
> **Source of truth:** This file. PR 1-3 cite section IDs.
> **Phase 11 lessons applied:** booking-shape contract reused
> verbatim (per `PHASE-11-ACTIVATION-NOTES.md` §"Booking shape
> contract"); cron + outbox + claim-RPC pattern reused;
> notification + canary singleton pattern reused; loose-cast
> for new tables until `npm run db:types` is wired.
>
> **Defaults inherited from Phase 9/10/11 conventions:**
> - Server-side flag gating (`ENABLE_MEDEVAC` mirror of
>   `ENABLE_CARGO`)
> - `requireClientSession()` + `requireOperatorSession()` +
>   `requireAdminSession()` discipline (Phase 8/9 patterns)
> - `password_must_change` operator guard at every Server Action
>   (Phase 8 round 1 PR #42 P1 #1; carried forward to PR 11)
> - Replay-safe migrations: `IF NOT EXISTS` for tables / columns /
>   indexes; `DO $$ pg_constraint guard` for CHECK constraints;
>   `CREATE OR REPLACE FUNCTION` for RPCs; `DROP TRIGGER IF EXISTS`
>   before `CREATE TRIGGER`
> - Phase 1 prototype cleanup pattern: refuses to drop if the
>   prototype table has rows; CASCADE-drop ENUMs + table after
>   founder confirms empty.
>
> **Out of scope (deferred to Phase 14):**
> - Aeris Shield recurring billing (HyperPay tokenization)
> - ZATCA invoicing per subscription event
> - Insurance API integration (claim filing through provider
>   APIs). Phase 12 only SNAPSHOTS insurance_provider +
>   claim_ref at intake time.

---

## §0 Objective

Build Aeris MedEvac end-to-end on the existing booking
foundation:
1. **Single-event medevac requests** — guest (stable severity
   only) + authed clients (any severity). Operators with
   matching medical certifications submit offers; clients/admin
   accept; bookings carry `source_discriminator='medevac'`.
2. **Aeris Shield subscription tier** — 4 plans (individual,
   family, vip_family, diamond). Annual flat fee; subscription
   holders trigger covered events that bypass the operator-quote
   loop (subscription-funded auto-dispatch to a pre-vetted
   operator).
3. **Medical operator certification matrix** — per-aircraft
   `supports_BMT/ALS/CCT/repatriation` + certifying authority +
   expiry. Distribution filters by certification at dispatch time
   (mirror Phase 11 PR 3 capability filter).
4. **Per-severity SLA dispatch** — critical = 1h, moderate = 4h,
   stable = 24h. Auto-escalate to admin if no operator response
   within window.

Phase 12 completes the 5-business-unit grid (Charter + Empty
Legs + Cargo + MedEvac + Privilege). Phase 13 (Privilege)
builds retention on top; Phase 14 (Payment + ZATCA) wires
HyperPay across all 5 verticals — Phase 12 explicitly leaves
all payment flow as `pending_offline`.

---

## §1 User journeys

### J1 — Public visitor (guest) submits stable medevac request

Anonymous browser visits `/medevac`. Form is constrained to
`severity='stable'` (the 3-tier ENUM excludes 'moderate' and
'critical' from the public path per Decision D1). User submits
patient name + age + service level (BMT or ALS only; CCT +
repatriation require authed account) + from_location +
to_hospital + insurance info (optional). Returns `MEV-XXXX`
reference + login CTA + WhatsApp escalation link for urgent
cases.

### J2 — Authed client submits any-severity medevac request

Authed client visits `/me/medevac/new`. Same form but allows
all 3 severities + all 4 service levels. If client has an
active Aeris Shield subscription with covered_events remaining,
form offers a "use subscription" toggle (Decision D13). If
toggled: request status defaults to `'covered'`; if not:
status `'pending'` and the operator-quote loop runs.

### J3 — Aeris Shield subscription signup

Authed client visits `/me/medevac/shield/subscribe`. Picks a
plan (individual / family / vip_family / diamond) + lists
covered_members (JSONB array). Signs up via Server Action that
INSERTs into `medevac_subscriptions` with `status='pending'`
(Phase 14 will flip to `'active'` after HyperPay tokenization
+ first annual charge succeeds). For Phase 12, admin manually
flips status via `/admin/medevac/subscriptions/[id]/activate`
after offline payment confirmation — same pattern as Phase 11
admin-on-behalf actions.

### J4 — Medical operator dispatch → accept → booking

Same loop as Phase 11 cargo PR 2/3 but with medical
certification filter:
- Operator A: aircraft certified for BMT + ALS only
- Operator B: aircraft certified for BMT + ALS + CCT + repatriation
- Request with `service_level='CCT'` dispatches ONLY to B.
- Operator B submits offer via `/operator/medevac/[id]/offer`;
  client accepts via `/me/medevac/[id]`; booking row created
  with `source_offer_table='medevac_offers'`,
  `source_discriminator='medevac'`.

### J5 — Subscription holder uses covered event

Authed client with active subscription + `covered_events_remaining > 0`
submits a medevac request and toggles "use subscription". The
RPC `consume_aeris_shield_event` decrements `used_events` AND
sets the new request's `status='covered'` AND immediately
creates a booking via a pre-vetted operator chosen by the
admin-configured `aeris_shield_default_operator_id`. No
operator-quote loop. The booking carries
`source_discriminator='medevac'` + `source_offer_table=NULL`
+ `source_offer_id=NULL` (Decision D6 variant — covered events
have no offer; the subscription itself is the contract).

---

## §2 Locked decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | Public `/medevac` form is restricted to `severity='stable'` ONLY. Moderate + critical require authed account. | Critical/moderate cases involve life-threatening conditions + insurance + immediate dispatch coordination — identity verification (client session) is non-negotiable. Stable cases are pre-planned transfers (e.g. specialist appointment in another city), low-PII-risk, suitable for anonymous intake. |
| **D2** | 4 service levels: `BMT`, `ALS`, `CCT`, `repatriation`. ENUM exactly matches Phase 1 scaffold values. | Standard medical transport hierarchy. `BMT` = Basic Medical Transport (stable patient, nurse onboard). `ALS` = Advanced Life Support (paramedic + vital signs monitoring). `CCT` = Critical Care Transport (ICU-grade equipment + critical care physician). `repatriation` = cross-border, includes customs + visa coordination. |
| **D3** | 3 condition severities: `stable`, `moderate`, `critical`. ENUM matches Phase 1 scaffold. | Triage standard. Severity gates the SLA tier (D10) + the public-form availability (D1). |
| **D4** | 4 Aeris Shield plans: `individual` (1 ALS event/yr), `family` (4 ALS/yr, ≤4 members), `vip_family` (12 CCT + repatriation, ≤6 members), `diamond` (unlimited CCT + repatriation + dedicated nurse coordinator). | Per business plan tiers (`subscription_plan` ENUM from Phase 1 scaffold). The annual_fee + covered_events + max_members are stored in a `medevac_subscription_plan_terms` lookup table (`§3.7`) so admin can adjust pricing without code deploy. |
| **D5** | Subscription model: annual upfront fee. Auto-renewal opt-out at end-of-term. `covered_members JSONB` is mutable POST-signup via admin Server Action only (defensive — clients shouldn't add their cousin's husband mid-year). | Phase 14 wires HyperPay recurring; Phase 12 only persists the fee + tracks `used_events`. |
| **D6** | Booking shape (identical to Phase 11 PR 2): `offer_id=NULL`, `trip_request_id=NULL`, `source_offer_table='medevac_offers'`, `source_offer_id=<UUID>`, `source_discriminator='medevac'`. EXCEPT for `J5` subscription-covered bookings: `source_offer_table=NULL`, `source_offer_id=NULL` (no offer; subscription is the contract). The Phase 6.2 pair-check constraint allows both-NULL or both-NOT-NULL; covered bookings use both-NULL. | Two booking sub-shapes inside one `source_discriminator='medevac'` value. `/me/bookings` chip renders the same; the source layer differentiates via the pair pattern. |
| **D7** | Per-aircraft medical certifications stored in `aircraft_medical_certifications` (NEW table, §3.5). Columns: `supports_BMT`, `supports_ALS`, `supports_CCT`, `supports_repatriation` (BOOL each), `certifying_authority` ENUM, `certification_number TEXT`, `certification_expires_at TIMESTAMPTZ`. | Mirrors `cargo_aircraft_capabilities` shape. Adds expiry tracking because medical certs (unlike cargo capability) have regulatory expiry windows. Cron `*/30 * * * *` checks expired rows + flips `supports_*` to `false` (Decision D11). |
| **D8** | `medevac_requests.patient_name_snapshot` + `patient_age_snapshot` are admin-only displays in **list/index** views. Per-actor visibility (Round 1 PR #75 P2 #7 fix — the original wording confused operator submit-offer with client/admin accept): (a) **Public surfaces** (`/cargo`, marketing) — never visible. (b) **Operator portal** (`/operator/medevac` + `/operator/medevac/[id]/offer`) — operators see MEV-XXXX + service_level + condition_severity + route ONLY while preparing offers; patient_name is REDACTED. (c) **Booked operator post-acceptance** (`/operator/medevac/offers` row for an accepted offer + the dispatch confirmation email/wa.me message sent post-accept) — the winning operator sees the full patient_name because they now need it for actual transport coordination. The transition is gated by `medevac_offers.status='accepted'`. (d) **Client portal** — clients see their own request's patient_name (it's their patient). (e) **Admin** — always sees patient_name (with `admin_pii_read` audit per D12). | PII minimization aligned with PDPL. The "operator sees nothing until they win" model prevents PII fanout — only the 1 booked operator gets the name, not all 5 dispatched operators in the candidate list. |
| **D9** | Insurance integration deferred to Phase 14. Phase 12 snapshots `insurance_provider_snapshot` + `insurance_claim_ref` at intake time but never calls a provider API. | Decoupling. Phase 14 HyperPay payment + ZATCA invoicing layer wires the claim filing pipeline. |
| **D10** | SLA response windows by severity: `critical=1h`, `moderate=4h`, `stable=24h`. Stored in `medevac_severity_sla` lookup table (§3.6) so admin can tune without code deploy. **No `dispatched` status in the enum** (Round 1 PR #75 P1 #1 fix). The PR 3 dispatch cron stamps `medevac_requests.dispatched_at = NOW()` on first successful claim+notify; the request stays in `status='pending'` (or `'offers_received'` once an operator quotes). The SLA escalation cron uses the timestamp + status filter: `medevac_requests WHERE status IN ('pending', 'offers_received') AND dispatched_at IS NOT NULL AND dispatched_at + sla_interval < NOW() AND sla_escalated_at IS NULL` → auto-escalate to admin via `founder_critical_escalation_email`. | Operator must quote within the SLA or auto-escalate. Critical=1h is the existing industry standard; stable=24h gives buffer for non-urgent transfers. Using `dispatched_at` (a timestamp) instead of a `'dispatched'` status keeps the status machine simple: no new transitions needed; existing `pending → offers_received → accepted` flow is unchanged. |
| **D11** | Medical cert expiry cron: `*/30 * * * *`. **Round 1 PR #75 P1 #4 fix — warning vs enforcement are SEPARATE actions.** (a) **Warning cascade (no flip):** sends `expired_medical_cert_alert` at 30/14/7/1 day(s) ahead of `certification_expires_at`; each warning email fires exactly once per renewal cycle via per-threshold `warning_{30,14,7,1}d_sent_at` flags on `aircraft_medical_certifications`. The cron sets the flag at send time; the flag stays set until the operator renews the cert (updates `certification_expires_at` to a new future timestamp) at which point the cron resets all 4 flags to NULL. The `supports_*` BOOLs stay TRUE during the warning window — the cert is still valid. (b) **Enforcement flip:** ONLY after the cert has actually expired (`certification_expires_at <= NOW()`) does the cron flip `supports_BMT/ALS/CCT/repatriation` to false AND send a final `medical_cert_expired_now` email. Distribution (PR 3) filters by cert AND `certification_expires_at > NOW()` as a belt-and-suspenders check. | Defensive — gives the operator a clear runway to renew (30/14/7/1 day cascade) without preemptively disabling dispatch. Per-threshold `*_sent_at` flags prevent the cron from re-emailing every 30 min for a month. Reset on renewal keeps the cascade reusable. |
| **D12** | PII redaction in `audit_logs`: never store `patient_name` in `new_value` JSONB. Store MEV-XXXX reference + `service_level` + `condition_severity` only. Same rule for any future analytics extracts. | Aligned with PDPL (Saudi data protection) minimization principle. Patient name lives in `medevac_requests.patient_name_snapshot` ONLY; admin queries against that column are logged separately as `admin_pii_read` events. |
| **D13** | Subscription-funded vs out-of-pocket flow: subscription holder toggles "use subscription" → request `status='covered'`, no operator-quote loop, immediate booking via `aeris_shield_default_operator_id` admin-configured value. Non-subscription or subscription-but-toggle-off → standard `status='pending'` + operator-quote loop. | The "use subscription" toggle is the user's explicit consent to consume one of their covered events (decrementing `used_events`); without toggle, the request stays out-of-pocket even if they have remaining events. |
| **D14** | Aeris Shield default operator: a single admin-configured operator (stored in `aeris_shield_config` singleton, §3.8) who has signed a master service agreement with Aeris and a guaranteed SLA. Used for covered events only (D13). Non-subscription requests still go through normal operator distribution. | Avoids dispatching covered events to operators who haven't signed the master SLA. Founder picks the operator via `/admin/medevac/shield-config`. |
| **D15** | `medevac_offers` table mirrors `cargo_offers` shape exactly (per-offer status + 7-day expiry + decided_at + decline/withdraw_reason columns). The PR 2 RPCs (`accept`, `decline`, `withdraw`, `cancel`) mirror Phase 11 PR 2 §4.4-§4.6 contracts verbatim with `cargo_` → `medevac_` rename. | Maximize code reuse + spec-language reuse. Codex review surface shrinks because reviewers can compare to the accepted Phase 11 contracts. |

---

## §3 Schema additions

### §3.1 — `medevac_requests` table (REBUILD)

Phase 1 prototype (initial_schema.sql lines 505-528) has a
different shape — drops the `client_id REFERENCES users(id)`
foreign key (Phase 9 split clients from users), adds
`*_snapshot` columns (Phase 9 PR 2 immutable-snapshot
discipline), and aligns with the Phase 11 cargo_requests
column layout.

**Phase 1 prototype cleanup is REQUIRED** (mirror cargo:
refuse drop if rows exist; CASCADE-drop + ENUM cleanup if
empty). The cleanup `DO $$` block fires BEFORE the
`CREATE TABLE` (same one-off pattern as Phase 11 cargo).

```sql
-- One-off Phase 1 prototype cleanup. Idempotent: no-op if the
-- legacy table is already absent.
DO $$
DECLARE
  v_row_count INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'medevac_requests'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM medevac_requests' INTO v_row_count;
    IF v_row_count > 0 THEN
      RAISE EXCEPTION
        'Legacy medevac_requests has % rows — manual migration required before drop.',
        v_row_count;
    END IF;
    DROP TABLE medevac_requests CASCADE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'medevac_subscriptions'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM medevac_subscriptions' INTO v_row_count;
    IF v_row_count > 0 THEN
      RAISE EXCEPTION
        'Legacy medevac_subscriptions has % rows — manual migration required before drop.',
        v_row_count;
    END IF;
    DROP TABLE medevac_subscriptions CASCADE;
  END IF;
  DROP TYPE IF EXISTS medevac_status CASCADE;
  DROP TYPE IF EXISTS medevac_severity CASCADE;
  DROP TYPE IF EXISTS medevac_service_level CASCADE;
  DROP TYPE IF EXISTS subscription_plan CASCADE;
  DROP TYPE IF EXISTS subscription_status CASCADE;
END $$;
```

Then the new ENUMs + table.

```sql
-- Replay-safe ENUMs (Phase 9 convention)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_severity' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_severity AS ENUM ('stable', 'moderate', 'critical');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_service_level' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_service_level AS ENUM ('BMT', 'ALS', 'CCT', 'repatriation');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_request_status' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_request_status AS ENUM (
      'pending',          -- waiting for offers (out-of-pocket path)
      'offers_received',  -- ≥1 operator offer in
      'accepted',         -- client/admin accepted → booking created
      'covered',          -- subscription-funded auto-dispatch (J5 path)
      'cancelled',        -- client/admin cancelled before acceptance
      'expired'           -- 7-day TTL hit without acceptance OR SLA window passed
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medevac_offer_status' AND n.nspname = 'public') THEN
    CREATE TYPE medevac_offer_status AS ENUM (
      'pending', 'accepted', 'declined', 'withdrawn', 'expired'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'aeris_shield_plan' AND n.nspname = 'public') THEN
    CREATE TYPE aeris_shield_plan AS ENUM (
      'individual', 'family', 'vip_family', 'diamond'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'aeris_shield_subscription_status' AND n.nspname = 'public') THEN
    CREATE TYPE aeris_shield_subscription_status AS ENUM (
      'pending_payment', 'active', 'expired', 'cancelled', 'suspended'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'medical_certifying_authority' AND n.nspname = 'public') THEN
    CREATE TYPE medical_certifying_authority AS ENUM (
      'SCFHS',                    -- Saudi Commission for Health Specialties
      'civil_aviation_authority', -- GACA medical aviation cert
      'foreign_equivalent',       -- e.g. FAA, EASA, GMC for repatriation flights
      'other'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS medevac_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medevac_request_number VARCHAR(20) NOT NULL UNIQUE
    DEFAULT 'MEV-' || substring(uuid_generate_v4()::TEXT, 1, 8),

  -- Path discriminator (guest vs authed)
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- Snapshots (Phase 9 PR 2 immutable-snapshot discipline)
  patient_name_snapshot VARCHAR(200) NOT NULL,
  patient_age_snapshot INT,
  contact_name_snapshot VARCHAR(120) NOT NULL,
  contact_phone_snapshot VARCHAR(20) NOT NULL,
  contact_email_snapshot VARCHAR(120),

  -- Triage
  condition_severity medevac_severity NOT NULL,
  service_level medevac_service_level NOT NULL,

  -- Route
  from_location_freeform VARCHAR(300) NOT NULL,
  from_iata VARCHAR(4),
  to_hospital_name VARCHAR(300) NOT NULL,
  to_hospital_contact_phone VARCHAR(20),
  to_hospital_freeform_address VARCHAR(300),
  to_iata VARCHAR(4),

  -- Insurance snapshot (D9 — Phase 14 wires actual claim filing)
  insurance_provider_snapshot VARCHAR(200),
  insurance_claim_ref VARCHAR(100),

  -- Pricing (estimated by client; operator quotes final)
  estimated_value_sar DECIMAL(14, 2) NOT NULL CHECK (estimated_value_sar > 0),

  -- Subscription linkage (D13 — used for J5 covered path)
  subscription_id UUID, -- FK added in §3.3 after medevac_subscriptions exists
  is_covered BOOLEAN NOT NULL DEFAULT false,
  -- is_covered=true → status MUST be 'covered'; CHECK constraint in §3.4

  -- Status + audit
  status medevac_request_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  accepted_offer_id UUID, -- FK added in §3.3 after medevac_offers exists
  dispatched_at TIMESTAMPTZ,
  sla_escalated_at TIMESTAMPTZ, -- D10 — set when cron escalates past SLA

  handling_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identity check: snapshots ALWAYS populated (mirrors Phase 11
  -- cargo_requests_identity_check)
  CONSTRAINT medevac_requests_identity_check CHECK (
    patient_name_snapshot IS NOT NULL
    AND contact_name_snapshot IS NOT NULL
    AND contact_phone_snapshot IS NOT NULL
  ),

  -- Public-path severity gate (D1)
  CONSTRAINT medevac_requests_guest_severity_check CHECK (
    client_id IS NOT NULL OR condition_severity = 'stable'
  ),

  -- Covered status invariant (D13) + subscription linkage
  -- invariant (Round 1 PR #75 P2 #6 fix). A covered request
  -- MUST have a non-NULL subscription_id — the subscription is
  -- the contract that backs the no-quote booking. The FK uses
  -- ON DELETE RESTRICT (§3.7 below) so deleting an active
  -- subscription that backs covered requests is blocked.
  CONSTRAINT medevac_requests_covered_invariant_check CHECK (
    (is_covered = false)
    OR (is_covered = true AND status = 'covered' AND subscription_id IS NOT NULL)
  ),

  -- Accepted requests must have accepted_offer_id OR be covered
  -- (mirrors Phase 11 cargo_requests_accepted_has_offer_check)
  CONSTRAINT medevac_requests_accepted_link_check CHECK (
    status <> 'accepted' OR accepted_offer_id IS NOT NULL
  ),

  -- Length caps (defense-in-depth)
  CONSTRAINT medevac_requests_value_positive_check CHECK (
    estimated_value_sar > 0
  ),
  CONSTRAINT medevac_requests_cancellation_reason_length_check CHECK (
    cancellation_reason IS NULL OR length(cancellation_reason) <= 500
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_medevac_requests_client
  ON medevac_requests (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_medevac_requests_status
  ON medevac_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medevac_requests_severity
  ON medevac_requests (condition_severity, created_at DESC)
  WHERE status IN ('pending', 'offers_received');
CREATE INDEX IF NOT EXISTS idx_medevac_requests_sla_pending
  ON medevac_requests (dispatched_at)
  WHERE status IN ('pending', 'offers_received')
    AND dispatched_at IS NOT NULL
    AND sla_escalated_at IS NULL;

-- RLS (clients can only see their own; service-role bypasses)
ALTER TABLE medevac_requests ENABLE ROW LEVEL SECURITY;
```

### §3.2 — `medevac_offers` table (NEW)

Mirrors `cargo_offers` shape exactly (per D15). Same per-offer
status + 7-day expiry + decided_at + decline/withdraw_reason
columns + operator snapshot widths.

```sql
CREATE TABLE IF NOT EXISTS medevac_offers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medevac_request_id UUID NOT NULL
    REFERENCES medevac_requests(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL
    REFERENCES operators(id) ON DELETE RESTRICT,
  aircraft_id UUID NOT NULL
    REFERENCES aircraft(id) ON DELETE RESTRICT,

  -- Snapshots
  operator_name_snapshot VARCHAR(200) NOT NULL,
  operator_phone_snapshot VARCHAR(20) NOT NULL,
  operator_email_snapshot VARCHAR(255) NOT NULL,
  aircraft_snapshot TEXT,
  medical_team_snapshot TEXT, -- e.g. "1× physician + 2× paramedics"

  -- Pricing
  base_price_sar DECIMAL(14, 2) NOT NULL
    CONSTRAINT medevac_offers_base_price_positive_check
      CHECK (base_price_sar > 0),
  medical_team_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT medevac_offers_medical_team_nonneg_check
      CHECK (medical_team_price_sar >= 0),
  insurance_coordination_price_sar DECIMAL(14, 2) NOT NULL DEFAULT 0
    CONSTRAINT medevac_offers_insurance_coord_nonneg_check
      CHECK (insurance_coordination_price_sar >= 0),
  total_price_sar DECIMAL(14, 2) GENERATED ALWAYS AS (
    base_price_sar + medical_team_price_sar + insurance_coordination_price_sar
  ) STORED,

  proposed_pickup_at TIMESTAMPTZ NOT NULL,
  proposed_arrival_at TIMESTAMPTZ NOT NULL,

  operator_notes TEXT,
  decline_reason TEXT,
  withdraw_reason TEXT,

  status medevac_offer_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  decided_at TIMESTAMPTZ,
  decided_by_user_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT medevac_offers_time_order_check CHECK (
    proposed_arrival_at > proposed_pickup_at
  ),
  CONSTRAINT medevac_offers_decline_reason_length_check CHECK (
    decline_reason IS NULL OR length(decline_reason) <= 500
  ),
  CONSTRAINT medevac_offers_withdraw_reason_length_check CHECK (
    withdraw_reason IS NULL OR length(withdraw_reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS idx_medevac_offers_request
  ON medevac_offers (medevac_request_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medevac_offers_operator
  ON medevac_offers (operator_id, status, created_at DESC);

ALTER TABLE medevac_offers ENABLE ROW LEVEL SECURITY;
```

### §3.3 — Cross-FKs (`accepted_offer_id` + `subscription_id`)

Both added AFTER both target tables exist, wrapped in
`pg_constraint` guards for replay safety.

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'medevac_requests_accepted_offer_fkey'
       AND conrelid = 'medevac_requests'::regclass
  ) THEN
    ALTER TABLE medevac_requests
      ADD CONSTRAINT medevac_requests_accepted_offer_fkey
      FOREIGN KEY (accepted_offer_id)
      REFERENCES medevac_offers(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- subscription_id FK added AFTER medevac_subscriptions exists (§3.7 below)
```

### §3.4 — `bookings` constraint extensions for medevac

Mirror Phase 11 §3.4 cargo extension exactly. Two CHECK updates:
1. `bookings_source_discriminator_check` allows `'medevac'`
2. `bookings_source_offer_check` allows `'medevac_offers'`

The Phase 6.2 `bookings_source_offer_pair_check` (both NULL OR
both NOT NULL) is UNCHANGED — Decision D6 covered bookings use
both-NULL (subscription is the contract), non-covered use
both-NOT-NULL (mirror cargo).

Also widen `bookings.operator_*_snapshot` widths to match
medevac_offers snapshots (which mirror cargo_offers from Phase
11 PR 1 round 3 P1 #1). Phase 11 PR 1 already widened them to
varchar(200)/varchar(255) — no change needed in PR 12.

### §3.5 — `aircraft_medical_certifications` table (NEW)

Per-aircraft cert matrix (D7 + D11). Mirrors
`cargo_aircraft_capabilities` shape with medical-specific
columns added — certifying authority, certification number,
expiry timestamp, plus the **warning-cascade flags** (Round 1
PR #75 P1 #4 fix) so each 30/14/7/1-day warning email fires
exactly once per renewal cycle.

**Round 1 PR #75 P1 #3 fix:** removed the bogus
`created_at_placeholder()` CHECK. Insert-time validation moves
into a BEFORE INSERT/UPDATE trigger (concrete body below) that
rejects new rows or capability re-enables whose
`certification_expires_at` is already in the past. UPDATE-from-
cron paths (the F4 enforcement flip) are allowed to leave the
past-expiry timestamp untouched while flipping `supports_*` to
false.

```sql
CREATE TABLE IF NOT EXISTS aircraft_medical_certifications (
  aircraft_id UUID PRIMARY KEY
    REFERENCES aircraft(id) ON DELETE CASCADE,
  supports_BMT BOOLEAN NOT NULL DEFAULT false,
  supports_ALS BOOLEAN NOT NULL DEFAULT false,
  supports_CCT BOOLEAN NOT NULL DEFAULT false,
  supports_repatriation BOOLEAN NOT NULL DEFAULT false,
  certifying_authority medical_certifying_authority NOT NULL,
  certification_number TEXT,
  certification_expires_at TIMESTAMPTZ NOT NULL,
  -- PR 3 — per-threshold warning state. Each flag is set when
  -- the matching warning email has been queued exactly once
  -- per renewal cycle; the cron resets all 4 flags to false
  -- when certification_expires_at is bumped forward (renewal).
  warning_30d_sent_at TIMESTAMPTZ,
  warning_14d_sent_at TIMESTAMPTZ,
  warning_7d_sent_at  TIMESTAMPTZ,
  warning_1d_sent_at  TIMESTAMPTZ,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT aircraft_medical_certifications_at_least_one_check CHECK (
    supports_BMT OR supports_ALS OR supports_CCT OR supports_repatriation
  )
);

-- Insert-time guard: a brand-new cert row CANNOT carry a past
-- expiry (would be useless). Trigger rejects this case. UPDATE
-- paths bypass the check — the cron's enforcement flip
-- (supports_* = false on actual expiry) intentionally leaves
-- the past-expiry timestamp in place so the row's history
-- stays auditable.
CREATE OR REPLACE FUNCTION reject_past_expiry_on_insert()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.certification_expires_at <= NOW() THEN
    RAISE EXCEPTION 'certification_expires_at must be in the future'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;
  -- On UPDATE: only reject if the operator is RE-ENABLING a
  -- `supports_*` flag AND the cert is past expiry. This is the
  -- one path the trigger blocks for UPDATEs: an admin trying to
  -- un-flip an expired cert without renewing the timestamp.
  IF TG_OP = 'UPDATE'
     AND NEW.certification_expires_at <= NOW()
     AND (
       (NEW.supports_BMT AND NOT OLD.supports_BMT)
       OR (NEW.supports_ALS AND NOT OLD.supports_ALS)
       OR (NEW.supports_CCT AND NOT OLD.supports_CCT)
       OR (NEW.supports_repatriation AND NOT OLD.supports_repatriation)
     )
  THEN
    RAISE EXCEPTION 'cannot re-enable supports_* on an expired certification'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_past_expiry_trigger
  ON aircraft_medical_certifications;
CREATE TRIGGER reject_past_expiry_trigger
  BEFORE INSERT OR UPDATE ON aircraft_medical_certifications
  FOR EACH ROW EXECUTE FUNCTION reject_past_expiry_on_insert();

ALTER TABLE aircraft_medical_certifications ENABLE ROW LEVEL SECURITY;
```

### §3.6 — `medevac_severity_sla` lookup table (NEW)

Admin-configurable SLA windows per severity (D10).

```sql
CREATE TABLE IF NOT EXISTS medevac_severity_sla (
  severity medevac_severity PRIMARY KEY,
  sla_interval INTERVAL NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 3 rows on migration apply
INSERT INTO medevac_severity_sla (severity, sla_interval) VALUES
  ('critical', INTERVAL '1 hour'),
  ('moderate', INTERVAL '4 hours'),
  ('stable',   INTERVAL '24 hours')
ON CONFLICT (severity) DO NOTHING;

ALTER TABLE medevac_severity_sla ENABLE ROW LEVEL SECURITY;
```

### §3.7 — `medevac_subscriptions` table + plan terms (NEW)

```sql
CREATE TABLE IF NOT EXISTS medevac_subscription_plan_terms (
  plan aeris_shield_plan PRIMARY KEY,
  annual_fee_sar DECIMAL(10, 2) NOT NULL CHECK (annual_fee_sar > 0),
  covered_events INT NOT NULL CHECK (covered_events > 0 OR covered_events = -1), -- -1 = unlimited (diamond)
  service_level medevac_service_level NOT NULL,
  includes_repatriation BOOLEAN NOT NULL DEFAULT false,
  max_covered_members INT NOT NULL CHECK (max_covered_members > 0),
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 4 plans (D4)
INSERT INTO medevac_subscription_plan_terms VALUES
  ('individual',  15000,  1, 'ALS', false,  1, 'Individual coverage — 1 ALS event/year'),
  ('family',      48000,  4, 'ALS', false,  4, 'Family — 4 ALS events/year, up to 4 members'),
  ('vip_family',  150000, 12, 'CCT', true,  6, 'VIP Family — 12 CCT events/year + repatriation, up to 6 members'),
  ('diamond',     400000, -1, 'CCT', true, 10, 'Diamond — unlimited CCT + repatriation + dedicated nurse coordinator')
ON CONFLICT (plan) DO NOTHING;

CREATE TABLE IF NOT EXISTS medevac_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_number VARCHAR(30) NOT NULL UNIQUE
    DEFAULT 'SHIELD-' || substring(uuid_generate_v4()::TEXT, 1, 8),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  plan aeris_shield_plan NOT NULL,
  -- Snapshot of plan terms at signup time (immutable — admin
  -- pricing changes don't retroactively re-bill existing
  -- subscribers)
  annual_fee_at_signup_sar DECIMAL(10, 2) NOT NULL,
  covered_events_at_signup INT NOT NULL,
  service_level_at_signup medevac_service_level NOT NULL,
  includes_repatriation_at_signup BOOLEAN NOT NULL,
  max_covered_members_at_signup INT NOT NULL,

  covered_members JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Shape: [{ name: TEXT, relationship: TEXT, dob: DATE }]

  used_events INT NOT NULL DEFAULT 0
    CHECK (used_events >= 0),

  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT true,
  status aeris_shield_subscription_status NOT NULL DEFAULT 'pending_payment',

  -- Payment hooks (Phase 14 wires HyperPay)
  payment_token_hash TEXT,
  last_renewal_at TIMESTAMPTZ,
  next_renewal_due TIMESTAMPTZ,

  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT medevac_subscriptions_date_order_check CHECK (
    end_date > start_date
  ),
  CONSTRAINT medevac_subscriptions_events_within_plan_check CHECK (
    -- Diamond (-1 unlimited) skips the cap; others enforce
    covered_events_at_signup = -1 OR used_events <= covered_events_at_signup
  ),
  CONSTRAINT medevac_subscriptions_cancellation_reason_length_check CHECK (
    cancellation_reason IS NULL OR length(cancellation_reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS idx_medevac_subscriptions_client
  ON medevac_subscriptions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medevac_subscriptions_status
  ON medevac_subscriptions (status, end_date)
  WHERE status IN ('active', 'pending_payment');

ALTER TABLE medevac_subscriptions ENABLE ROW LEVEL SECURITY;

-- Now add the deferred FK on medevac_requests.subscription_id.
-- Round 1 PR #75 P2 #6 fix — ON DELETE RESTRICT (was SET NULL).
-- Covered medevac_requests carry the subscription as their
-- contract; orphaning that link would break the
-- medevac_requests_covered_invariant_check + leave audit gaps
-- (we wouldn't know which subscription consumed the event).
-- If a subscription needs to be deleted, the admin path must
-- first archive/null-out the covered requests' is_covered flag
-- (a future archival flow; not in Phase 12 scope).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'medevac_requests_subscription_fkey'
       AND conrelid = 'medevac_requests'::regclass
  ) THEN
    ALTER TABLE medevac_requests
      ADD CONSTRAINT medevac_requests_subscription_fkey
      FOREIGN KEY (subscription_id)
      REFERENCES medevac_subscriptions(id) ON DELETE RESTRICT;
  END IF;
END $$;
```

### §3.8 — `aeris_shield_config` singleton (NEW)

**Round 1 PR #75 P1 #5 fix — `default_operator_id` uses
`ON DELETE RESTRICT`** (was `SET NULL`). A subscription holder
attempting to use a covered event when the configured default
operator was deleted is a fatal config error, not a silent
fallback to no-operator. RESTRICT forces admin to pick a
replacement before they can delete the operator row.

`consume_aeris_shield_event` (§4.7) checks the operator is
non-NULL + approved + has matching medical certification BEFORE
inserting the booking — see the structured-error list there.

```sql
CREATE TABLE IF NOT EXISTS aeris_shield_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- ON DELETE RESTRICT — admin must pick a replacement before
  -- deleting the configured operator.
  default_operator_id UUID REFERENCES operators(id) ON DELETE RESTRICT,
  founder_notification_email VARCHAR(120),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO aeris_shield_config (id, default_operator_id, founder_notification_email)
  VALUES (1, NULL, 'basem902@gmail.com')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE aeris_shield_config ENABLE ROW LEVEL SECURITY;
```

### §3.9 — `medevac_email_alert_status` singleton (NEW)

Mirrors `cargo_email_alert_status` (Phase 11 PR 1 §3.6). Powers
the 7th `<ChannelHealth>` card on `/admin/operators/canary` in
PR 3.

### §3.10 — `medevac_dispatch_events_outbox` (PR 3 only, NEW)

Mirrors `cargo_dispatch_events_outbox` (Phase 11 PR 3 §1) — same
claim_id + claimed_at + processed_at + dispatch_result shape.
PR 3 ships this; PR 1+2 leave it for the distribution layer.

---

## §4 RPC layer

All 9 RPCs mirror Phase 11 cargo signatures exactly with
`cargo_` → `medevac_` rename; full SQL bodies follow Phase
11 patterns. Section IDs match Phase 11 numbering for
side-by-side review.

### §4.1 — `create_medevac_request_guest` (PR 1)

Mirror of Phase 11 §4.1 `create_cargo_request_guest`.
Difference: enforces `condition_severity='stable'` (D1) at
the RPC layer before the `INSERT`. Returns
`{ok: false, error: 'severity_requires_account'}` for any
moderate/critical guest submission. The CHECK constraint
`medevac_requests_guest_severity_check` is the second line of
defense.

### §4.2 — `create_medevac_request_authenticated` (PR 1)

Mirror of Phase 11 §4.2. Allows all severities. If client has
an active subscription with `covered_events_remaining > 0`
AND payload includes `use_subscription: true`, branches to the
J5 covered path: calls `consume_aeris_shield_event` RPC (§4.7)
which atomically decrements `used_events` AND inserts the
booking AND sets request status to `'covered'`.

### §4.3 — `submit_medevac_offer` (PR 1)

Mirror of Phase 11 §4.3 `submit_cargo_offer`. Capability check
queries `aircraft_medical_certifications` instead of
`cargo_aircraft_capabilities`. Also checks
`certification_expires_at > NOW()` (D11 — don't accept offers
from expired-cert aircraft).

### §4.4 — `accept_medevac_offer` (PR 2)

Mirror of Phase 11 §4.4 `accept_cargo_offer`. Booking shape:
`source_offer_table='medevac_offers'`,
`source_discriminator='medevac'`. PII redaction (D12) in audit
log: stores MEV-XXXX + service_level + condition_severity only.

### §4.5 — `decline_medevac_offer` + `withdraw_medevac_offer` (PR 2)

Mirror of Phase 11 §4.5. Auth-before-idempotency carries
forward.

### §4.6 — `cancel_medevac_request` (PR 2)

Mirror of Phase 11 §4.6.

### §4.7 — `consume_aeris_shield_event` (PR 1)

NEW — no Phase 11 equivalent. Atomically (all in one transaction):

1. **Lock the subscription FOR UPDATE** so concurrent calls
   can't double-consume the same event slot.
2. **Verify subscription state:** `status='active'` AND
   `end_date > NOW()` AND
   (`covered_events_at_signup = -1` OR
    `used_events < covered_events_at_signup`).
   Failure → `{ok: false, error: 'subscription_not_consumable'}`.
3. **Verify service-level eligibility:** the requested
   `service_level` must be ≤ subscription's
   `service_level_at_signup` (e.g. individual plan can't claim
   CCT). Failure → `{ok: false, error: 'service_level_above_plan'}`.
4. **Load + verify aeris_shield_config.default_operator_id**
   (Round 1 PR #75 P1 #5 fix — was implicit; now an explicit
   structured-error gate):
   - 4a. `default_operator_id IS NOT NULL` → else
     `{ok: false, error: 'shield_default_operator_missing'}`
   - 4b. Operator exists AND `signup_status='approved'` → else
     `{ok: false, error: 'shield_default_operator_not_approved'}`
   - 4c. Operator has at least one aircraft with
     `aircraft_medical_certifications` matching the requested
     `service_level` AND `certification_expires_at > NOW()`
     → else `{ok: false, error: 'shield_default_operator_not_certified'}`
   - 4d. Operator has non-NULL `contact_email` + `contact_phone`
     (we need usable snapshots for the booking row) → else
     `{ok: false, error: 'shield_default_operator_missing_contact'}`
   - 4e. Pick the FIRST capable aircraft from the result of 4c
     (ordered by `aircraft_medical_certifications.updated_at DESC`
     for determinism); snapshot its `id` + manufacturer/model
     into the booking row.
5. **Increment `used_events`** on the subscription.
6. **Insert the `medevac_requests` row** with `is_covered=true`,
   `subscription_id=p_subscription_id`, `status='covered'`.
   (Per §3.1 `medevac_requests_covered_invariant_check`, this
   pairing is enforced at the DB layer.)
7. **Insert the `bookings` row** with
   `source_offer_table=NULL`, `source_offer_id=NULL` (D6 covered
   variant), `source_discriminator='medevac'`,
   `operator_id` + snapshots from step 4, customer snapshots
   from the client + medevac_request, `payment_status='covered'`
   (NEW value — added in PR 1 migration alongside cargo's
   `'pending_offline'`).
8. **Audit log entry** (PII redacted per D12 — store
   MEV-XXXX + service_level + condition_severity only).

Returns `{ok: true, medevac_request_id, booking_id,
covered_events_remaining, dispatched_operator_id}`.

The whole RPC body is wrapped in `BEGIN ... EXCEPTION WHEN
OTHERS THEN ROLLBACK; RAISE; END;` so a failure at any step
leaves the subscription's `used_events` unchanged.

### §4.8 — `subscribe_to_aeris_shield` (PR 2)

NEW — wraps the `medevac_subscriptions` INSERT. Validates
covered_members count ≤ plan's max_covered_members_at_signup.
Snapshots plan_terms into the row. Returns `{ok: true,
subscription_id, subscription_number, status: 'pending_payment'}`.
Phase 14 flips status to 'active' after HyperPay tokenization.

### §4.9 — `admin_activate_subscription` (PR 2)

NEW — admin-only path for Phase 12 (before Phase 14 wires
HyperPay). Flips `status` from `'pending_payment'` to
`'active'`, sets `start_date=NOW()` + `end_date=NOW() + INTERVAL '1 year'`,
+ `next_renewal_due=end_date - INTERVAL '30 days'`.

---

## §5 PR breakdown

**Round 1 PR #75 P1 #2 — exact PR inventory locked below.** Each
PR's migration creates a defined set of tables + seeds + RPCs;
no implicit cross-PR dependencies. Subscription tables (and
their plan-terms seed + aeris_shield_config seed) live in PR 1
because `consume_aeris_shield_event` (§4.7) and
`subscribe_to_aeris_shield` (§4.8) — both J2/J3 day-1 surfaces
— need them.

### PR 1 — Backend + public form + admin intake (~2200 lines)

**Migration** `20260525000040_phase_12_pr_1_medevac_intake.sql`:

| # | Object | Defined in §|
|---|---|---|
| 1 | Phase 1 prototype cleanup `DO $$` block | §3.1 |
| 2 | ENUM `medevac_severity` | §3.1 |
| 3 | ENUM `medevac_service_level` | §3.1 |
| 4 | ENUM `medevac_request_status` (6 values, NO `dispatched`) | §3.1 |
| 5 | ENUM `medevac_offer_status` | §3.1 |
| 6 | ENUM `aeris_shield_plan` | §3.1 |
| 7 | ENUM `aeris_shield_subscription_status` | §3.1 |
| 8 | ENUM `medical_certifying_authority` | §3.1 |
| 9 | Table `medevac_requests` + CHECKs + indexes + RLS | §3.1 |
| 10 | Table `medevac_offers` + CHECKs + indexes + RLS | §3.2 |
| 11 | FK `medevac_requests.accepted_offer_id → medevac_offers(id)` ON DELETE RESTRICT | §3.3 |
| 12 | `bookings_source_discriminator_check` extension to allow `'medevac'` | §3.4 |
| 13 | `bookings_source_offer_check` extension to allow `'medevac_offers'` | §3.4 |
| 14 | Table `aircraft_medical_certifications` + CHECKs + RLS | §3.5 |
| 15 | Lookup `medevac_severity_sla` + 3-row seed | §3.6 |
| 16 | Lookup `medevac_subscription_plan_terms` + 4-row seed | §3.7 |
| 17 | Table `medevac_subscriptions` + CHECKs + indexes + RLS | §3.7 |
| 18 | FK `medevac_requests.subscription_id → medevac_subscriptions(id)` ON DELETE RESTRICT (Round 1 PR #75 P2 #6 fix) | §3.7 |
| 19 | Singleton `aeris_shield_config` + 1-row seed | §3.8 |
| 20 | Singleton `medevac_email_alert_status` + 1-row seed | §3.9 |
| 21 | RPC `create_medevac_request_guest` (§4.1) | §4.1 |
| 22 | RPC `create_medevac_request_authenticated` (§4.2) | §4.2 |
| 23 | RPC `submit_medevac_offer` (§4.3) | §4.3 |
| 24 | RPC `consume_aeris_shield_event` (§4.7) | §4.7 |
| 25 | RPC `subscribe_to_aeris_shield` (§4.8) | §4.8 |

**Server Actions** (`app/actions/`):
- `medevac-public.ts`: `submitMedevacRequestPublic` (wraps §4.1)
- `medevac-admin.ts`: `upsertMedicalCertification` (mirrors
  `upsertCargoAircraftCapability`)

**Pages:**
- `/medevac` — public intake form (stable only)
- `/admin/medevac` — queue
- `/admin/medevac/[id]` — detail (patient_name admin-only)
- `/admin/medevac/medical-certifications` — per-aircraft matrix

**Tests** (`lib/medevac/__tests__/`):
- `medevac-request-validators.test.ts` (~20 cases)

### PR 2 — Authed portal + offer/booking + subscriptions (~1700 lines)

**Migration** `20260526000041_phase_12_pr_2_medevac_offers_subs.sql`:

| # | Object | Defined in §|
|---|---|---|
| 1 | RPC `accept_medevac_offer` (§4.4) | §4.4 |
| 2 | RPC `decline_medevac_offer` (§4.5) | §4.5 |
| 3 | RPC `withdraw_medevac_offer` (§4.5) | §4.5 |
| 4 | RPC `cancel_medevac_request` (§4.6) | §4.6 |
| 5 | RPC `admin_activate_subscription` (§4.9) | §4.9 |
| 6 | Column `medevac_requests.founder_sla_escalated_at` (per-request escalation throttle) | §3.1 |

(All schema deltas wrapped in `IF NOT EXISTS` / pg_constraint
guards. No new tables — only the column + 5 new RPCs.)

**Server Actions** (`app/actions/`):
- `medevac-clients.ts`: 5 wrappers
  - `submitMedevacRequestAuthed` (wraps §4.2)
  - `acceptMyMedevacOffer` (wraps §4.4 client path)
  - `declineMyMedevacOffer` (wraps §4.5 decline)
  - `cancelMyMedevacRequest` (wraps §4.6)
  - `subscribeToAerisShield` (wraps §4.8 — moved here from
    public path because subscription requires authed client)
- `medevac-operators.ts`: 2 wrappers + `password_must_change`
  guard
  - `submitMedevacOffer` (wraps §4.3)
  - `withdrawMyMedevacOffer` (wraps §4.5 withdraw)
- `medevac-admin.ts` extension: 4 admin actions
  - `adminAcceptMedevacOfferOnBehalf`
  - `adminDeclineMedevacOfferOnBehalf`
  - `adminCancelMedevacRequestOnBehalf`
  - `adminActivateSubscription` (wraps §4.9)

**Pages (12 total):**

Client portal:
- `/me/medevac` — list
- `/me/medevac/new` — authed form (all severities)
- `/me/medevac/[id]` — detail + offers + accept/decline/cancel
- `/me/medevac/shield/subscribe` — plan picker
- `/me/medevac/shield/[id]` — subscription detail

Operator portal:
- `/operator/medevac` — available requests
- `/operator/medevac/[id]/offer` — submit offer form
- `/operator/medevac/offers` — operator's offers list

Admin extensions:
- `/admin/medevac/[id]` extended with accept/decline/cancel
- `/admin/medevac/subscriptions` — pending_payment queue
- `/admin/medevac/subscriptions/[id]/activate` — activation
- `/admin/medevac/shield-config` — set default_operator_id

**Tests:**
- `medevac-accept-flow.test.ts` (~10 cases)
- `medevac-booking-shape.test.ts` (~10 cases — pins BOTH
  non-covered AND covered booking shapes per D6)
- `medevac-offer-validators.test.ts` (~20 cases)
- `aeris-shield-coverage.test.ts` (~8 cases — pins event
  consumption rules)

### PR 3 — Distribution + SLA cron + notifications + canary (~1300 lines)

**Migration** `20260527000042_phase_12_pr_3_medevac_distribution.sql`:

| # | Object | Defined in §|
|---|---|---|
| 1 | Table `medevac_dispatch_events_outbox` (mirror cargo) | §3.10 |
| 2 | RPC `publish_medevac_dispatch_event` | (mirror Phase 11 PR 3 §2) |
| 3 | RPC `claim_medevac_dispatch_events` | (mirror Phase 11 PR 3 §4) |
| 4 | RPC `medevac_operator_last_dispatch_map` | (mirror Phase 11 PR 3 §5) |
| 5 | Trigger `medevac_requests` AFTER INSERT → publish 'initial' for `is_covered=false` rows only | NEW (covered rows skip the outbox entirely since they self-book in §4.7) |
| 6 | Cert expiry tracking columns on `aircraft_medical_certifications` (per-threshold flags) | §3.5 + Round 1 PR #75 P1 #4 |

**TS pipeline** (`lib/medevac/`):
- `scoring.ts` — pure scoring
- `distribution.ts` — DB-backed dispatch + medical cert filter
- `notifications.ts` — operator email + wa.me link (patient
  name redaction per D8/F7)
- `founder-sla-escalation-email.ts` — escalation alert

**Cron routes:**
- `/api/cron/medevac/dispatch-drain` — every 5 minutes
- `/api/cron/medevac/sla-escalation` — every 5 minutes
- `/api/cron/medevac/expire-certifications` — every 30 min.
  Round 1 PR #75 P1 #4 fix — two phases:
  - **Warning phase** (cert still valid): scans rows where
    `certification_expires_at - NOW() <= 30/14/7/1 day` AND the
    matching `warning_*d_sent_at` IS NULL. Sends one email per
    matching threshold + stamps the `warning_*d_sent_at`. Does
    NOT flip `supports_*`.
  - **Enforcement phase** (cert expired): scans rows where
    `certification_expires_at <= NOW() AND (supports_BMT OR
    supports_ALS OR supports_CCT OR supports_repatriation)`.
    Flips all `supports_*` to false + sends final
    `medical_cert_expired_now` email + audits the flip.
  - **Renewal reset** (cert bumped forward): scans rows where
    `certification_expires_at > NOW() AND (warning_30d_sent_at
    IS NOT NULL OR ...)` AND the new expiry > 30 days out.
    Resets all 4 `warning_*d_sent_at` to NULL so the cascade
    is reusable for the next cycle.

**Admin extensions:**
- 7th `<ChannelHealth>` card on `/admin/operators/canary`
- `/admin/medevac/[id]/distribute` — manual dispatch button

**Tests:**
- `medevac-distribution-scoring.test.ts` (~12 cases)
- `medevac-sla-escalation.test.ts` (~6 cases)
- `medevac-outbox-drain.test.ts` (~6 cases)
- `medevac-cron-auth.test.ts` (5 cases)
- `medical-cert-expiry.test.ts` (~6 cases — warning cascade +
  enforcement flip — F4)

---

## §6 Founder probes

**8 probes for Phase 12 (probes 33-40; numbering continues from
Phase 11's probe 32).** Round 1 PR #75 P2 #8 fix — summary was
stale; PR 1 ships probes 33-34, PR 2 adds 35-36 + 38, PR 3
adds 37 + 39-40.

### Probe 33 — Schema state (PR 1, before flag flip)

40+ boolean checks: 7 ENUMs + 4 tables + 4 lookup-seed
verifications + all CHECK constraints + RLS on every new
table + 7 indexes. Mirrors Phase 11 Probe 28 (33 checks).

### Probe 34 — Guest stable medevac request appears in admin queue

1. POST `/medevac` (anonymous) with `severity='stable'`,
   `service_level='BMT'`, valid contact + patient info.
2. Verify CGO-XXXX-style MEV-XXXX reference returned.
3. Verify admin queue at `/admin/medevac` shows the row.
4. Attempt to submit `severity='critical'` from public path →
   400 with `severity_requires_account`.

### Probe 35 — Authed medevac request shows in /me/medevac

(Same as Probe 30 but for medevac.)

### Probe 36 — Offer → accept → booking with medevac chip

1. Operator with ALS certification submits offer.
2. Client accepts.
3. Verify booking row shape: `source_offer_table='medevac_offers'`,
   `source_discriminator='medevac'`, `offer_id=NULL`,
   `trip_request_id=NULL`.
4. Verify `/me/bookings` chip shows "إخلاء طبي" (NEW emerald
   color or red — Phase 12 spec decides; recommendation:
   red/rose since medevac is medical-urgent).

### Probe 37 — Distribution filters by medical certification

(Mirror Probe 32.) 2 medical operators, only 1 with CCT
certification. Submit CCT request. Trigger cron. Verify only
the CCT-certified operator received dispatch; the other
appears in `skip_reasons['no_certification']`.

### Probe 38 — Aeris Shield covered event

1. Client signs up for individual plan → admin activates →
   subscription becomes active.
2. Client submits medevac request with `use_subscription=true`.
3. Verify atomic: `used_events=1`, booking created via
   `aeris_shield_config.default_operator_id`,
   `source_offer_id=NULL`, `is_covered=true`,
   `status='covered'`.

### Probe 39 — SLA escalation cron

1. Insert medevac request with `severity='critical'` +
   `status='pending'` + `dispatched_at = NOW() - INTERVAL '2 hours'`
   (past 1h SLA — `dispatched_at` is set by the dispatch cron's
   notify step per Round 1 PR #75 P1 #1; we backdate it here to
   simulate a past-SLA row).
2. Trigger `/api/cron/medevac/sla-escalation`.
3. Verify `sla_escalated_at` populated + founder alert email
   queued.

### Probe 40 — Expired medical cert removal

1. Insert aircraft_medical_certification with
   `certification_expires_at = NOW() - INTERVAL '1 day'`.
2. Trigger `/api/cron/medevac/expire-certifications`.
3. Verify all `supports_*` flipped to `false`.

---

## §7 Acceptance + activation runbook

### Codex review checkpoint
- [ ] Spec PR reaches Codex 100/100 (this document)
- [ ] PR 1 reaches Codex 100/100 (backend + intake + admin)
- [ ] PR 2 reaches Codex 100/100 (authed + offer/booking + subs)
- [ ] PR 3 reaches Codex 100/100 (distribution + cron + canary)

### Production activation (per spec §10 of Phase 11 cargo)

1. Apply PR 1 migration. Run Probe 33 (schema) + Probe 34
   (guest path).
2. Set `ENABLE_MEDEVAC=false` initially.
3. After PR 1 + PR 2 deploy: flip `ENABLE_MEDEVAC=true` →
   redeploy. Run probes 35, 36, 38.
4. After PR 3 deploy: add cron entries to vercel.json +
   confirm `CRON_SECRET` (re-use Phase 7). Run probes 37, 39, 40.
5. **CRITICAL pre-launch:** Resend domain verification
   (`aeris.sa`) MUST be complete before onboarding any real
   medical operator — same follow-up as Phase 11 cargo.
6. After 7 days production health: Phase 12 closure ceremony.

---

## §8 Codex review history

(To be filled by Codex during review.)

| Round | Findings | Resolved at |
|---|---|---|
| 0 | (initial draft) | — |
