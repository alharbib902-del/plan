# Phase 12 — Aeris MedEvac (Medical Evacuation + Aeris Shield)

> **Status:** Spec under active Codex review; see §8 for the
> current resolved-round ledger. (Round 16 PR #75 P2 #1 fix
> retired the per-round rolling wording — that pattern was
> stale by the next round every time. The §8 table is now
> the single source of truth for the latest resolved round.)
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
   `supports_bmt/als/cct/repatriation` + certifying authority +
   expiry. Distribution filters by certification at dispatch time
   (mirror Phase 11 PR 3 capability filter). Column names are
   lowercase because Postgres folds unquoted SQL identifiers to
   lowercase at DDL time, so the PostgREST JSON keys + TS
   payloads MUST match (Round 3 PR #76 P1 #1 fix).
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
INSERTs into `medevac_subscriptions` with
`status='pending_payment'` (Round 5 PR #75 P1 #1 fix — the
`aeris_shield_subscription_status` ENUM is `pending_payment /
active / expired / cancelled / suspended`; the legacy
`'pending'` value never existed and would fail the cast).
Phase 14 will flip to `'active'` after HyperPay tokenization
+ first annual charge succeeds. For Phase 12, admin manually
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
| **D4** | 4 Aeris Shield plans: `individual` (1 ALS event/yr), `family` (4 ALS/yr, ≤4 members), `vip_family` (12 CCT + repatriation, ≤6 members), `diamond` (unlimited CCT + repatriation + dedicated nurse coordinator). | Per business plan tiers. Round 5 PR #75 P2 #3 fix — the enum is `aeris_shield_plan` (defined in §3.1 alongside the other Phase 12 ENUMs); the Phase 1 scaffold's `subscription_plan` type is dropped by the cleanup migration and MUST NOT be resurrected by PR 1. Both `medevac_subscription_plan_terms.plan` (PK) and `medevac_subscriptions.plan` (FK to the lookup) are typed `aeris_shield_plan`. The annual_fee + covered_events + max_members are stored in the `medevac_subscription_plan_terms` lookup table (§3.7) so admin can adjust pricing without code deploy. |
| **D5** | Subscription model: annual upfront fee. Auto-renewal opt-out at end-of-term. `covered_members JSONB` is mutable POST-signup via admin Server Action only (defensive — clients shouldn't add their cousin's husband mid-year). **Round 6 PR #75 P1 #3 fix — every covered person (including the subscription owner) MUST be listed as an entry in `covered_members` with both `name` AND `dob` populated**; the admin Server Action that mutates the JSONB MUST validate uniqueness on the pair `(lower(BTRIM(name)), dob)` before persisting, and §4.8 `subscribe_to_aeris_shield` MUST seed the owner row at signup time (`{name: clients.full_name, relationship: 'self', dob: <payload.dob>}` — payload provides the owner's dob because the `clients` table itself has no `date_of_birth` column). §4.7 covered-event consumption matches the (name, dob) pair, not name alone, so family-plan name collisions can't burn the wrong person's event. The `relationship='self'` entry is the only one created automatically; family members for family/VIP/Diamond plans are admin-added post-activation. | Phase 14 wires HyperPay recurring; Phase 12 only persists the fee + tracks `used_events`. The (name, dob) pair is the stable identifier — covered_members entries are admin-controlled lookup keys, not opaque ids, so audits remain human-readable. |
| **D6** | Booking shape (identical to Phase 11 PR 2): `offer_id=NULL`, `trip_request_id=NULL`, `source_offer_table='medevac_offers'`, `source_offer_id=<UUID>`, `source_discriminator='medevac'`. EXCEPT for `J5` subscription-covered bookings: `source_offer_table=NULL`, `source_offer_id=NULL` (no offer; subscription is the contract). The Phase 6.2 pair-check constraint allows both-NULL or both-NOT-NULL; covered bookings use both-NULL. | Two booking sub-shapes inside one `source_discriminator='medevac'` value. `/me/bookings` chip renders the same; the source layer differentiates via the pair pattern. |
| **D7** | Per-aircraft medical certifications stored in `aircraft_medical_certifications` (NEW table, §3.5). Columns: `supports_bmt`, `supports_als`, `supports_cct`, `supports_repatriation` (BOOL each), `certifying_authority` ENUM, `certification_number TEXT`, `certification_expires_at TIMESTAMPTZ`. Column names are lowercase (Round 3 PR #76 P1 #1 fix — Postgres folds unquoted SQL identifiers, so the PostgREST JSON keys + the TS row type MUST use lowercase byte-for-byte). | Mirrors `cargo_aircraft_capabilities` shape. Adds expiry tracking because medical certs (unlike cargo capability) have regulatory expiry windows. Cron `*/30 * * * *` checks expired rows + flips `supports_*` to `false` (Decision D11). |
| **D8** | `medevac_requests.patient_name_snapshot` + `patient_age_snapshot` are PII; render them only on the audited admin detail surface. Per-actor visibility (Round 1 PR #75 P2 #7 fix — the original wording confused operator submit-offer with client/admin accept; **Round 10 PR #75 P1 #1 fix — admin list/index is NOT a PII surface**, contradicting the original "admin-only displays in list/index views" wording which would have let `/admin/medevac` expose patient_name without an audit row): (a) **Public surfaces** (`/cargo`, marketing) — never visible. (b) **Operator portal** (`/operator/medevac` + `/operator/medevac/[id]/offer`) — operators see MEV-XXXX + service_level + condition_severity + route ONLY while preparing offers; patient_name is REDACTED. (c) **Booked operator post-acceptance** (`/operator/medevac/offers` row for an accepted offer + the dispatch confirmation email/wa.me message sent post-accept) — the winning operator sees the full patient_name because they now need it for actual transport coordination. The transition is gated by `medevac_offers.status='accepted'`. (d) **Client portal** — clients see their own request's patient_name (it's their patient). (e) **Admin list/index (`/admin/medevac` queue, `/admin/medevac/medical-certifications`, future admin search/export endpoints)** — MUST render MEV-XXXX + service_level + condition_severity + route + status only; `patient_name_snapshot` + `patient_age_snapshot` are NEVER selected. PR 1 enforces this via `listAdminMedevacRequests()` whose SELECT projection omits both columns; future admin list paths added in PR 2/PR 3 MUST reuse the same helper or follow the same projection. (f) **Admin detail (`/admin/medevac/[id]` only)** — the single audited PII surface. Loads exclusively via `readAdminMedevacRequestDetail` → SECURITY DEFINER RPC `admin_read_medevac_request_detail` (§4.10), which writes the `admin_pii_read` audit row + returns the patient-bearing payload in one atomic transaction (D12 contract). Any future admin path that needs patient_name MUST go through the same RPC; bypassing it via a direct service-role SELECT is a spec violation. | PII minimization aligned with PDPL. The "operator sees nothing until they win" model prevents PII fanout — only the 1 booked operator gets the name, not all 5 dispatched operators in the candidate list. The split between admin list (redacted) and admin detail (audited) means every privileged read is attributable to a specific admin session window + request UUID; the list view satisfies the operational queue need without spraying PII into pages that don't need it. |
| **D9** | Insurance integration deferred to Phase 14. Phase 12 snapshots `insurance_provider_snapshot` + `insurance_claim_ref` at intake time but never calls a provider API. | Decoupling. Phase 14 HyperPay payment + ZATCA invoicing layer wires the claim filing pipeline. |
| **D10** | SLA response windows by severity: `critical=1h`, `moderate=4h`, `stable=24h`. Stored in `medevac_severity_sla` lookup table (§3.6) so admin can tune without code deploy. **No `dispatched` status in the enum** (Round 1 PR #75 P1 #1 fix). The PR 3 dispatch cron stamps `medevac_requests.dispatched_at = NOW()` on first successful claim+notify; the request stays in `status='pending'` (or `'offers_received'` once an operator quotes). The SLA escalation cron uses the timestamp + status filter: `medevac_requests WHERE status IN ('pending', 'offers_received') AND dispatched_at IS NOT NULL AND dispatched_at + sla_interval < NOW() AND sla_escalated_at IS NULL` → auto-escalate to admin via `founder_critical_escalation_email`. | Operator must quote within the SLA or auto-escalate. Critical=1h is the existing industry standard; stable=24h gives buffer for non-urgent transfers. Using `dispatched_at` (a timestamp) instead of a `'dispatched'` status keeps the status machine simple: no new transitions needed; existing `pending → offers_received → accepted` flow is unchanged. |
| **D11** | Medical cert expiry cron: `*/30 * * * *`. **Round 1 PR #75 P1 #4 fix — warning vs enforcement are SEPARATE actions.** (a) **Warning cascade (no flip):** sends `expired_medical_cert_alert` at 30/14/7/1 day(s) ahead of `certification_expires_at`; each warning email fires exactly once per renewal cycle via per-threshold `warning_{30,14,7,1}d_sent_at` flags on `aircraft_medical_certifications`. The cron sets the flag at send time; the flag stays set until the operator renews the cert (updates `certification_expires_at` to a new future timestamp **strictly more than 30 days out**, i.e. `certification_expires_at > NOW() + INTERVAL '30 days'`, Round 4 PR #75 P2 #4 fix — without the > 30 days condition a cert renewed mid-warning-window would reset the flags and the cron would re-send every threshold on the next tick) at which point the cron resets all 4 flags to NULL. The `supports_*` BOOLs stay TRUE during the warning window — the cert is still valid. (b) **Enforcement flip:** ONLY after the cert has actually expired (`certification_expires_at <= NOW()`) does the cron flip `supports_bmt/als/cct/repatriation` to false AND send a final `medical_cert_expired_now` email. Distribution (PR 3) filters by cert AND `certification_expires_at > NOW()` as a belt-and-suspenders check. | Defensive — gives the operator a clear runway to renew (30/14/7/1 day cascade) without preemptively disabling dispatch. Per-threshold `*_sent_at` flags prevent the cron from re-emailing every 30 min for a month. Reset only on > 30-day renewal keeps the cascade single-fire per cycle and prevents email spam loops on mid-window renewals. |
| **D12** | PII redaction in `audit_logs`: never store `patient_name` in `new_value` JSONB. Store MEV-XXXX reference + `service_level` + `condition_severity` only. Same rule for any future analytics extracts. Round 5 PR #75 P2 #4 fix — the `admin_pii_read` audit surface is owned by PR 1. **Round 6 PR #75 P1 #1 fix — `audit_logs.user_id` is set to `NULL`** because Aeris admin auth is cookie-based (`ADMIN_INBOX_PASSWORD` + HMAC-signed `aeris_admin` cookie per `lib/admin/auth.ts`); `requireAdminSession()` returns a `VerifiedCookie = {valid, expiry}` payload with no `users.id`. Inserting a non-existent UUID would either violate the FK or trail false attribution. Admin identity is therefore captured in `new_value` JSONB via the cookie's `expiry` timestamp + a derived `cookie_fingerprint` (HMAC of the cookie value with a server-only key, so audit logs are queryable per-session without leaking the cookie itself) instead. **Round 6 PR #75 P1 #2 fix — the read is performed by a SECURITY DEFINER RPC `admin_read_medevac_request_detail` (PR 1 §4.10) so the audit INSERT and the PII SELECT live in the same statement-level transaction**. The TS helper `readAdminMedevacRequestDetail` (`lib/medevac/admin-pii.ts`) is now a thin caller that (a) builds the session-metadata JSONB from `requireAdminSession()` plus the cookie fingerprint, (b) calls the RPC, (c) returns its result. If the audit INSERT fails inside the RPC, Postgres aborts the whole call — no PII row is returned, no partial audit lands, and the page surfaces a generic error. The redacted list-view counterpart (`listAdminMedevacRequests`) selects no patient_name_snapshot/patient_age_snapshot at all and writes no audit. | Aligned with PDPL (Saudi data protection) minimization principle. Patient name lives in `medevac_requests.patient_name_snapshot` ONLY; the `admin_pii_read` event makes every privileged read attributable to a specific admin session window + request without ever copying the name into the audit row, and the SECURITY DEFINER RPC makes the "audit before read" claim a database-enforced invariant rather than an application-layer convention. |
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

  -- Path discriminator (guest vs authed). Round 3 PR #75
  -- P2 #4 fix — `ON DELETE RESTRICT` (was `SET NULL`). With
  -- SET NULL, deleting an authed client would null this row's
  -- `client_id` and instantly turn it into a "guest" row,
  -- which would then violate `medevac_requests_guest_severity_check`
  -- for any row whose severity is not `'stable'`. RESTRICT
  -- forces admin to first archive / null-out the request
  -- (e.g. anonymise via a future GDPR/PDPL erasure
  -- Server Action that snapshots the patient PII into
  -- audit_logs and either deletes or hard-anonymises the
  -- row) before the client row can be removed. Guest rows
  -- (`client_id IS NULL`) are unaffected because they hold
  -- no FK reference.
  client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
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
  -- invariant (Round 1 PR #75 P2 #6 fix; tightened to two-way
  -- in Round 2 PR #75 P1 #2 fix). A covered request MUST have
  -- a non-NULL subscription_id — the subscription is the
  -- contract that backs the no-quote booking. The FK uses
  -- ON DELETE RESTRICT (§3.7 below) so deleting an active
  -- subscription that backs covered requests is blocked.
  -- The first CHECK enforces the two-way equivalence
  -- `(is_covered = true) = (status = 'covered')` so we cannot
  -- ship a "covered" request without a Shield contract NOR a
  -- non-covered request that still sits in `status='covered'`
  -- (which would otherwise bypass the normal quote/dispatch
  -- flow). The second CHECK enforces `status='covered' →
  -- subscription_id IS NOT NULL`.
  CONSTRAINT medevac_requests_covered_status_equiv_check CHECK (
    (is_covered = true) = (status = 'covered')
  ),
  CONSTRAINT medevac_requests_covered_has_subscription_check CHECK (
    status <> 'covered' OR subscription_id IS NOT NULL
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
-- Round 3 PR #76 P1 #1 fix — column identifiers are lowercase
-- explicitly here. Postgres folds unquoted `supports_BMT` etc.
-- to `supports_bmt` at DDL time anyway, but writing lowercase
-- removes the ambiguity for readers + matches the PostgREST
-- JSON keys the TS layer (lib/medevac/types.ts +
-- app/actions/medevac-admin.ts + cert-matrix-editor.tsx) must
-- use byte-for-byte.
CREATE TABLE IF NOT EXISTS aircraft_medical_certifications (
  aircraft_id UUID PRIMARY KEY
    REFERENCES aircraft(id) ON DELETE CASCADE,
  supports_bmt BOOLEAN NOT NULL DEFAULT false,
  supports_als BOOLEAN NOT NULL DEFAULT false,
  supports_cct BOOLEAN NOT NULL DEFAULT false,
  supports_repatriation BOOLEAN NOT NULL DEFAULT false,
  certifying_authority medical_certifying_authority NOT NULL,
  certification_number TEXT,
  certification_expires_at TIMESTAMPTZ NOT NULL,
  -- Per-threshold warning state. Owned by PR 1 schema
  -- (Round 1 PR #75 P1 #4 fix landed these columns here);
  -- consumed by the PR 3 cron `expire-certifications` which
  -- sets each flag exactly once per renewal cycle when the
  -- matching warning email has been queued, then resets all
  -- 4 flags to NULL when `certification_expires_at` is bumped
  -- forward (renewal). PR 3 does NOT re-add the columns.
  warning_30d_sent_at TIMESTAMPTZ,
  warning_14d_sent_at TIMESTAMPTZ,
  warning_7d_sent_at  TIMESTAMPTZ,
  warning_1d_sent_at  TIMESTAMPTZ,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Round 3 PR #75 P1 #1 fix — the "at least one supports_*
  -- must be true" rule used to be a table-level CHECK
  -- (`aircraft_medical_certifications_at_least_one_check`).
  -- That blocked the PR 3 expire-certifications cron from
  -- flipping all four flags to false on actual expiry, so
  -- expired certs could never be disabled. The rule is now
  -- enforced inside the BEFORE INSERT OR UPDATE trigger
  -- below, which differentiates an admin/operator edit
  -- (must keep at least one flag true) from the cron
  -- enforcement path (allowed to flip all to false when
  -- `certification_expires_at <= NOW()`).
);

-- Insert/update guard. Centralises three rules:
--   (a) a brand-new cert row CANNOT carry a past expiry
--       (would be useless);
--   (b) admin/operator UPDATEs CANNOT re-enable a `supports_*`
--       flag on a cert that has already expired (would let an
--       expired cert silently come back online without
--       renewing the timestamp);
--   (c) an UPDATE that would leave the row with ALL FOUR
--       `supports_*` = false is only permitted when the cert
--       has already expired (i.e. the PR 3 cron enforcement
--       flip). Any other path (admin edit, operator self-
--       service) must keep at least one flag true.
-- INSERTs must also satisfy the at-least-one rule.
CREATE OR REPLACE FUNCTION enforce_aircraft_medical_certifications()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
BEGIN
  -- (a) INSERT: future expiry only.
  IF TG_OP = 'INSERT' AND NEW.certification_expires_at <= NOW() THEN
    RAISE EXCEPTION 'certification_expires_at must be in the future'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- (b) UPDATE on expired cert: forbid re-enable of any flag.
  IF TG_OP = 'UPDATE'
     AND NEW.certification_expires_at <= NOW()
     AND (
       (NEW.supports_bmt AND NOT OLD.supports_bmt)
       OR (NEW.supports_als AND NOT OLD.supports_als)
       OR (NEW.supports_cct AND NOT OLD.supports_cct)
       OR (NEW.supports_repatriation AND NOT OLD.supports_repatriation)
     )
  THEN
    RAISE EXCEPTION 'cannot re-enable supports_* on an expired certification'
      USING ERRCODE = '22023';
  END IF;

  -- (c) "At least one supports_* true" rule (Round 3 PR #75
  -- P1 #1 fix — was a table CHECK; moved here so the cron
  -- enforcement flip can pass).
  IF NOT (NEW.supports_bmt OR NEW.supports_als
          OR NEW.supports_cct OR NEW.supports_repatriation)
  THEN
    -- INSERTs may never start with all-false.
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'at least one supports_* flag must be true on insert'
        USING ERRCODE = '23514';  -- check_violation
    END IF;
    -- UPDATEs may go to all-false ONLY when the cert is
    -- already expired (the cron enforcement path). Any
    -- other caller has to keep at least one flag true.
    IF TG_OP = 'UPDATE' AND NEW.certification_expires_at > NOW() THEN
      RAISE EXCEPTION 'at least one supports_* flag must remain true on non-expiry update'
        USING ERRCODE = '23514';  -- check_violation
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_past_expiry_trigger
  ON aircraft_medical_certifications;
DROP TRIGGER IF EXISTS enforce_aircraft_medical_certifications_trigger
  ON aircraft_medical_certifications;
CREATE TRIGGER enforce_aircraft_medical_certifications_trigger
  BEFORE INSERT OR UPDATE ON aircraft_medical_certifications
  FOR EACH ROW EXECUTE FUNCTION enforce_aircraft_medical_certifications();

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

-- Round 4 PR #75 P2 #3 fix — Probe 33 enforces RLS on every
-- new table. The plan-terms table holds pricing + caps + the
-- repatriation flag, which are part of the public commercial
-- offering (the /medevac/subscribe page renders them) but the
-- READ path goes through a server-side helper, NOT a direct
-- REST query, so we keep RLS enabled with NO public policies
-- (service-role bypass only). The pricing surface fetches the
-- 4 rows via `getAerisShieldPlanTerms()` (PR 2 helper in
-- `lib/medevac/plan-terms.ts`) which uses `createAdminClient()`
-- and returns a sanitised projection { plan, annual_fee_sar,
-- covered_events, service_level, includes_repatriation,
-- max_covered_members, description } to the marketing page.
-- Admin price updates go through a future
-- `admin_update_plan_terms` Server Action (Phase 14 + HyperPay
-- recurring) that's also service-role; clients cannot touch
-- this table directly at any tier.
ALTER TABLE medevac_subscription_plan_terms ENABLE ROW LEVEL SECURITY;

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

  -- Round 2 PR #75 P1 #1 fix — nullable until activation. §4.8
  -- `subscribe_to_aeris_shield` inserts the row with
  -- status='pending_payment' BEFORE any payment lands; the dates
  -- are stamped by §4.9 admin_activate_subscription (Phase 12)
  -- or HyperPay webhook (Phase 14). The status-conditional CHECK
  -- (medevac_subscriptions_active_has_dates_check below) enforces
  -- the dates ONCE status hits 'active'.
  start_date DATE,
  end_date DATE,
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

  -- Round 2 PR #75 P1 #1 fix — date order check is now
  -- conditional on the dates being populated. Pending_payment
  -- rows can sit with NULL dates; activation MUST populate both
  -- with end_date > start_date.
  CONSTRAINT medevac_subscriptions_date_order_check CHECK (
    start_date IS NULL OR end_date IS NULL OR end_date > start_date
  ),
  -- The status gate: enforces dates ONCE the subscription has
  -- actually been activated. `pending_payment` rows can sit
  -- with NULL dates pre-activation (Round 2 PR #75 P1 #1 fix).
  -- `cancelled` rows ALSO permit NULL dates (Round 6 PR #75 P2
  -- #4 fix) because a user/admin must be able to cancel a
  -- never-activated subscription cleanly, without inventing a
  -- start_date / end_date pair that never existed. Pre-
  -- activation cancellation leaves both dates NULL; post-
  -- activation cancellation preserves the dates stamped at
  -- activation time (so the OR's right branch keeps holding).
  -- `active`, `expired`, and `suspended` ALWAYS require both
  -- dates, since those states are only reachable after
  -- activation.
  CONSTRAINT medevac_subscriptions_active_has_dates_check CHECK (
    status IN ('pending_payment', 'cancelled')
    OR (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date > start_date)
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

**Round 3 PR #75 P2 #5 fix — full DDL + helper semantics
inlined (was: "mirrors cargo, see PR 1 §3.6").** PR 1 ships
the table + seed exactly as below. PR 3 ships the consumer
(7th `<ChannelHealth>` card on `/admin/operators/canary`) and
the writer (operator dispatch + founder-batch emails).

```sql
CREATE TABLE IF NOT EXISTS medevac_email_alert_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO medevac_email_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE medevac_email_alert_status ENABLE ROW LEVEL SECURITY;
```

**Status values (identical to cargo):**
- `'healthy'` — last Resend call succeeded.
- `'config_missing'` — env vars missing (e.g. RESEND_API_KEY,
  RESEND_FROM_EMAIL). Distinct from `send_failed` so the
  canary card can render a different remediation hint.
- `'send_failed'` — last Resend call returned a non-2xx or
  threw; `last_failure_reason` truncated to 200 chars.

**Helper contract** (`lib/medevac/email-alert-status.ts`,
PR 3 — mirror of `lib/cargo/email-alert-status.ts`):

```typescript
export interface MedevacEmailAlertStatusRow {
  id: 1;
  status: 'healthy' | 'config_missing' | 'send_failed';
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string;
}

export interface RecordArgs {
  status: 'healthy' | 'config_missing' | 'send_failed';
  reason?: string;
}

// Called by lib/medevac/notifications.ts (operator dispatch
// emails) AND lib/medevac/founder-batch-email.ts after every
// Resend send. On `'healthy'`, clears `last_failure_*`; on
// failure statuses, stamps `last_failure_at = NOW()` and
// truncates `reason` to 200 chars. Wraps the Supabase call in
// try/catch and logs (never throws — the alert path must not
// break the parent send).
export async function recordMedevacEmailAlertStatus(
  args: RecordArgs
): Promise<void>;

// Called by the 7th canary card reader. Returns NULL on any
// read error (so the card renders an "unknown" state rather
// than crashing the page).
export async function getMedevacEmailAlertStatus():
  Promise<MedevacEmailAlertStatusRow | null>;
```

Both helpers use `createAdminClient()` (service-role). The
table is RLS-enabled with no public/anon/authenticated
policies, so direct REST reads are blocked — only the
service-role helpers above can touch the row.

### §3.10 — `medevac_dispatch_events_outbox` (PR 3 only, NEW)

Mirrors `cargo_dispatch_events_outbox` (Phase 11 PR 3 §1) — same
claim_id + claimed_at + processed_at + dispatch_result shape.
PR 3 ships this; PR 1+2 leave it for the distribution layer.

### §3.11 — `safe_parse_date` helper (PR 1, NEW)

**Round 8 PR #75 P2 #1 fix.** Used by §4.7 step 4 (consume-
side `covered_members.dob` filter) AND by the admin
covered_members Server Action's write-time validator, so a
malformed/overflowed date in JSONB can never raise a raw
Postgres error. Returns NULL for ANY parse failure: NULL
input, non-ISO-8601 shape, OR shape-valid-but-semantically-
invalid date like `"2026-02-31"` / `"2026-13-01"` /
`"2026-99-99"`. The nested `BEGIN ... EXCEPTION ... END;`
block catches `invalid_datetime_format` (SQLSTATE 22007)
AND `datetime_field_overflow` (22008); no other exception
class is swallowed so genuine bugs still surface.

```sql
CREATE OR REPLACE FUNCTION safe_parse_date(p_text TEXT)
  RETURNS DATE
  LANGUAGE plpgsql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_text IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  -- Nested exception block for structured error mapping
  -- ONLY (Round 3 PR #75 P1 #2 fix rules: no ROLLBACK /
  -- COMMIT / SET TRANSACTION inside). Catches both error
  -- classes the cast can raise on shape-valid input.
  BEGIN
    RETURN p_text::DATE;
  EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RETURN NULL;
  END;
END;
$$;

REVOKE ALL ON FUNCTION safe_parse_date(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION safe_parse_date(TEXT) TO service_role;
```

The function is `IMMUTABLE` + `PARALLEL SAFE` so the planner
can evaluate it once per call site at plan time and inline
freely inside the `jsonb_array_elements` lateral scan.

---

## §4 RPC layer

Cargo lifecycle RPCs mirror Phase 11 where noted; Shield /
admin PII RPCs are medevac-specific (Round 12 PR #75 P2 #1
fix — the previous "All 9 RPCs mirror Phase 11 cargo
signatures exactly" wording was stale: `consume_aeris_
shield_event` (§4.7), `subscribe_to_aeris_shield` (§4.8),
`admin_activate_subscription` (§4.9), and `admin_read_
medevac_request_detail` (§4.10) have no cargo equivalent,
§4.5 carries two RPCs (decline + withdraw), and the count
also includes the §3.11 `safe_parse_date` helper; the bare
"9" is no longer accurate). Each RPC section below names
its own Phase 11 mirror when one exists; the medevac-only
RPCs spell out their full step lists in place. Section IDs
keep Phase 11 numbering for side-by-side review where the
mirror applies.

### §4.1 — `create_medevac_request_guest` (PR 1)

Mirror of Phase 11 §4.1 `create_cargo_request_guest`.
Difference: enforces `condition_severity='stable'` (D1) at
the RPC layer before the `INSERT`. Returns
`{ok: false, error: 'severity_requires_account'}` for any
moderate/critical guest submission. The CHECK constraint
`medevac_requests_guest_severity_check` is the second line of
defense.

### §4.2 — `create_medevac_request_authenticated` (PR 1)

Mirror of Phase 11 §4.2. Allows all severities. **ALWAYS
inserts an out-of-pocket `status='pending'` request** — the
J5 Shield covered branch is NOT handled inside this RPC
(implementation deviation from the original draft, applied
in PR #76 Round 1 P1 #1 fix and finalised here in PR #76
Round 2 P2 #2 fix so the spec stays the single source of
truth).

The J5 covered branch lives in the PR 2 Server Action
wrapper `submitMedevacRequestAuthed` which inspects
`payload.use_subscription` and, when `true`, dispatches
directly to §4.7 `consume_aeris_shield_event` with the 5
required params already known at the TS layer
(`p_subscription_id`, `p_client_id`,
`p_patient_member_name`, `p_patient_member_dob`,
`p_payload`). Two reasons for the split:
- keeps each SECURITY DEFINER RPC single-purpose so the
  contract surface stays narrow + auditable;
- §4.7 needs an already-resolved subscription_id +
  patient (name, dob) pair — putting that lookup inside
  §4.2 would duplicate the Server Action's subscription /
  member resolution and double-buy the failure modes.

Defense-in-depth: §4.2 returns the structured error
`use_subscription_must_route_to_shield_rpc` if a caller
passes `use_subscription: true` (or any of the
case-insensitive truthy values `'1' / 't' / 'yes'`) so
the RPC never silently inserts an out-of-pocket row that
would skip `used_events` decrement + the covered booking
insert. PR 2 implementers MUST call §4.7 directly for the
covered path, NOT this RPC.

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

NEW — no Phase 11 equivalent. Atomically (all in one transaction).

**Signature** (Round 4 PR #75 P1 #2 fix — expanded to bind
the consumption to the authenticated client AND to a covered
patient. Round 6 PR #75 P1 #3 fix — patient identifier
replaced by the stable `(name, dob)` pair so family-plan
namesakes can't burn each other's covered events):

```sql
consume_aeris_shield_event(
  p_subscription_id     UUID,    -- subscription to consume
  p_client_id           UUID,    -- caller's clients.id
                                 -- (passed by Server Action
                                 -- from the verified
                                 -- requireClientSession())
  p_patient_member_name TEXT,    -- canonical name to be
                                 -- matched in covered_members
                                 -- (case + whitespace
                                 -- normalised before
                                 -- comparison; original casing
                                 -- preserved on snapshot)
  p_patient_member_dob  DATE,    -- exact DOB of the covered
                                 -- person; pairs with name
                                 -- to form the stable lookup
                                 -- key per D5
  -- ...the remaining request payload params (service_level,
  -- condition_severity, route, insurance snapshot, etc.)
  -- carried forward from §4.2 inputs
) RETURNS JSON
```

Step list (executes inside a single statement-level
transaction; any RAISE EXCEPTION aborts and reverts all
prior writes — see Atomicity note below):

1. **Lock the subscription FOR UPDATE** so concurrent calls
   can't double-consume the same event slot.
2. **Verify subscription ownership** (Round 4 PR #75 P1 #2
   fix — was missing; a bad caller or buggy Server Action
   could otherwise consume another client's covered event).
   The locked row's `client_id` MUST equal `p_client_id`.
   Failure → `{ok: false, error: 'subscription_not_owned'}`.
   The error code is intentionally identical to
   `subscription_not_consumable` from the caller's point of
   view ONLY when surfaced through the Server Action wrapper,
   so a bad actor can't probe ownership; the RPC-level error
   stays distinct for ops/audit.
3. **Verify subscription state:** `status='active'` AND
   `end_date > NOW()` AND
   (`covered_events_at_signup = -1` OR
    `used_events < covered_events_at_signup`).
   Failure → `{ok: false, error: 'subscription_not_consumable'}`.
4. **Verify patient covered-member eligibility** (Round 4
   PR #75 P1 #2 fix — was missing; Round 5 PR #75 P2 #2 fix —
   carry forward the canonical name, not the normalised key;
   Round 6 PR #75 P1 #3 fix — match the stable `(name, dob)`
   pair instead of name alone, eliminating family-plan
   namesake collisions). Compute the normalised name
   `v_normalised_name := BTRIM(lower(p_patient_member_name))`
   for comparison only, then look up the single matching
   entry in `v_subscription.covered_members`:

   ```sql
   -- Round 7 PR #75 P2 #3 fix — regex-gate the dob cast.
   -- Round 8 PR #75 P2 #1 fix — the regex alone still let
   -- shape-valid but semantically invalid dates like
   -- "2026-02-31" or "2026-99-99" through to the cast,
   -- which then raised `datetime_field_overflow` (SQLSTATE
   -- 22008) and surfaced as a raw Postgres error instead
   -- of `patient_not_covered`. We now route both the
   -- regex AND the cast through the shared
   -- `safe_parse_date(TEXT) RETURNS DATE` helper (defined
   -- in §3.11 below) which catches BOTH
   -- `invalid_datetime_format` (22007) and
   -- `datetime_field_overflow` (22008) inside a nested
   -- exception block and returns NULL for either. The
   -- admin Server Action that mutates covered_members per
   -- D5 runs the SAME helper on write to reject bad input
   -- early; the consume-side filter is belt-and-
   -- suspenders.
   SELECT BTRIM(m->>'name')           -- canonical, casing kept
     INTO v_canonical_patient_name
     FROM jsonb_array_elements(v_subscription.covered_members) AS m
    WHERE lower(BTRIM(m->>'name')) = v_normalised_name
      AND safe_parse_date(m->>'dob') = p_patient_member_dob
    LIMIT 1;
   ```

   If `v_canonical_patient_name IS NULL` → `{ok: false,
   error: 'patient_not_covered'}`. There is no longer an
   implicit "owner is always covered" branch — per D5 the
   owner is seeded as a `covered_members` entry with
   `relationship='self'` by §4.8 `subscribe_to_aeris_shield`
   at signup time (the owner's DOB comes from the signup
   payload because the `clients` table has no
   `date_of_birth` column). Owners and family members
   therefore go through the same lookup path. Admin-added
   `covered_members` rows are mutable per D5 — this check
   always reads the row inside the FOR UPDATE lock (step 1)
   so a concurrent admin edit can't slip an unauthorised
   member in mid-consume. The admin Server Action that
   mutates `covered_members` MUST validate uniqueness on
   `(lower(BTRIM(name)), dob)` before persisting; the
   `LIMIT 1` above is defensive belt-and-suspenders, not a
   tie-breaker.

   Before the lookup, **reject future-DOB inputs**
   defensively (Round 9 PR #75 P1 #1 fix):

   ```sql
   IF p_patient_member_dob IS NULL
      OR p_patient_member_dob > CURRENT_DATE THEN
     RETURN json_build_object(
       'ok', false,
       'error', 'patient_dob_invalid'
     );
   END IF;
   ```

   The covered_members write path (admin Server Action per
   D5) applies the SAME check via `safe_parse_date` plus a
   `dob <= CURRENT_DATE` guard, so a future DOB shouldn't
   reach consume time; this is belt-and-suspenders against
   payload drift.

   The canonical name lands in step 8's
   `medevac_requests.patient_name_snapshot`. The age (an
   INT column per §3.1) is computed and pinned to integer
   years as **Round 9 PR #75 P1 #1 fix — `AGE(...)` returns
   an INTERVAL, which cannot insert into INT and would
   crash the covered path**:

   ```sql
   patient_age_snapshot :=
     EXTRACT(YEAR FROM AGE(CURRENT_DATE, p_patient_member_dob))::INT;
   ```

   `CURRENT_DATE` (date, not timestamptz) keeps the
   computation deterministic across TZ; `AGE` between two
   dates is always non-negative once the future-DOB guard
   above passed; `EXTRACT(YEAR FROM ...)::INT` collapses
   the year component to a plain INT that the column
   accepts. The normalised key + raw DOB params are
   transient compare values and are not otherwise
   persisted.

5. **Verify service-level eligibility** (Round 3 PR #75 P1 #3
   fix — explicit matrix; do NOT rely on `medevac_service_level`
   ENUM ordering since that's a label set, not a business
   hierarchy. Round 4 PR #75 P1 #1 fix — decomposed into two
   orthogonal checks so the seeded `vip_family` / `diamond`
   plans, which use `service_level_at_signup='CCT'` +
   `includes_repatriation=true`, can in fact claim a
   `repatriation` request. The previous matrix wording
   listed `repatriation` only under `service_level_at_signup
   = 'repatriation'`, which blocked the realistic case).

   The two checks run as an OR — the request is entitled iff
   EITHER applies:

   **(a) Non-repatriation entitlement matrix.** Applies when
   the requested `service_level` is NOT `'repatriation'`. The
   matrix below gives the allowed request values keyed by the
   subscription's `service_level_at_signup`; the flag plays no
   role here.

   | subscription `service_level_at_signup` | allowed non-repatriation request `service_level` |
   |---|---|
   | `BMT`           | `BMT`                                    |
   | `ALS`           | `BMT`, `ALS`                             |
   | `CCT`           | `BMT`, `ALS`, `CCT`                      |
   | `repatriation`  | `BMT`, `ALS`, `CCT`                      |

   **(b) Repatriation entitlement.** Applies when the
   requested `service_level` IS `'repatriation'`. Only one
   condition matters: `includes_repatriation_at_signup =
   true`. The `service_level_at_signup` value is irrelevant —
   the flag is the single source of truth (D4 sets it as
   vip_family / diamond → true, individual / family → false).

   Implementation: encode (a) as a CASE expression on
   `service_level_at_signup` returning a `text[]` of allowed
   non-repatriation request values; then evaluate

   ```sql
   (p_requested_service_level <> 'repatriation'
    AND p_requested_service_level = ANY(non_repat_allowed))
   OR
   (p_requested_service_level = 'repatriation'
    AND v_subscription.includes_repatriation_at_signup = true)
   ```

   Failure of the disjunction → `{ok: false, error:
   'service_level_not_entitled'}`.
6. **Load + verify aeris_shield_config.default_operator_id**
   (Round 1 PR #75 P1 #5 fix — was implicit; now an explicit
   structured-error gate):
   - 6a. `default_operator_id IS NOT NULL` → else
     `{ok: false, error: 'shield_default_operator_missing'}`
   - 6b. Operator exists AND `signup_status='approved'` → else
     `{ok: false, error: 'shield_default_operator_not_approved'}`
   - 6c. Operator has at least one aircraft with
     `aircraft_medical_certifications` matching the requested
     `service_level` AND `certification_expires_at > NOW()`
     → else `{ok: false, error: 'shield_default_operator_not_certified'}`
   - 6d. Operator has non-NULL `contact_email` + `contact_phone`
     (we need usable snapshots for the booking row) → else
     `{ok: false, error: 'shield_default_operator_missing_contact'}`
   - 6e. Pick the FIRST capable aircraft from the result of 6c
     (ordered by `aircraft_medical_certifications.updated_at DESC`
     for determinism); snapshot its `id` + manufacturer/model
     into the booking row.
7. **Increment `used_events`** on the subscription.
8. **Insert the `medevac_requests` row** with `is_covered=true`,
   `subscription_id=p_subscription_id`, `status='covered'`.
   (Per §3.1 `medevac_requests_covered_invariant_check`, this
   pairing is enforced at the DB layer.)
9. **Insert the `bookings` row** with
   `source_offer_table=NULL`, `source_offer_id=NULL` (D6 covered
   variant), `source_discriminator='medevac'`,
   `operator_id` + snapshots from step 6, customer snapshots
   from the client + medevac_request, `payment_status =
   'pending_offline'` (Round 2 PR #75 P1 #3 fix — no enum
   extension; the row is recognisable as covered via the
   composite signal `source_discriminator='medevac'` + both
   `source_offer_table` and `source_offer_id` NULL, which is
   already enforced by Phase 6.2
   `bookings_source_offer_pair_check`; the Shield contract
   stays linked through `medevac_requests.subscription_id`
   established in step 6).
10. **Audit log entry** (PII redacted per D12 — store
    MEV-XXXX + service_level + condition_severity only; the
    canonical patient name resolved in step 4 lands on
    `medevac_requests.patient_name_snapshot` per step 8 and
    is NEVER written into `audit_logs.new_value` JSONB. The
    normalised lookup key from step 4 is a transient compare
    value; it is not persisted anywhere).

Returns `{ok: true, medevac_request_id, booking_id,
covered_events_remaining, dispatched_operator_id}`.

**Atomicity (Round 3 PR #75 P1 #2 fix).** PL/pgSQL functions
cannot issue `ROLLBACK` directly — Postgres already runs the
entire RPC inside a single statement-level transaction, so any
unhandled exception thrown from step 2-10 aborts the whole
function and reverts the `used_events` increment (step 7)
together with the request + booking inserts (steps 8-9).
Implementation: do NOT add transaction-control statements
inside the function body; just let domain errors propagate by
calling `RAISE EXCEPTION ... USING ERRCODE = '<sqlstate>'`
from each guard. The only acceptable `BEGIN … EXCEPTION WHEN
... END;` blocks are nested ones used purely for structured
error mapping (e.g. catching a specific `unique_violation`
from the booking insert and re-raising it as a friendlier
error code) — they must NOT contain `ROLLBACK`, `COMMIT`, or
`SET TRANSACTION`.

### §4.8 — `subscribe_to_aeris_shield` (PR 2)

NEW — wraps the `medevac_subscriptions` INSERT. Validates
covered_members count ≤ plan's max_covered_members_at_signup.
Snapshots plan_terms into the row. Returns `{ok: true,
subscription_id, subscription_number, status: 'pending_payment'}`.
Phase 14 flips status to 'active' after HyperPay tokenization.

**Owner-seeding contract (Round 6 PR #75 P1 #3 fix).** The
RPC takes a required `p_owner_dob DATE` parameter (the
subscription owner's date of birth; collected on the
`/me/medevac/shield/subscribe` form) and prepends the owner
to `covered_members` before validating size + persisting:

```sql
v_covered_members := jsonb_build_array(
  jsonb_build_object(
    'name', (SELECT full_name FROM clients WHERE id = p_client_id),
    'relationship', 'self',
    'dob', to_jsonb(p_owner_dob)
  )
) || COALESCE(p_payload_covered_members, '[]'::jsonb);
```

Then enforce uniqueness on `(lower(BTRIM(name)), dob)`
across the resulting array (RAISE EXCEPTION
`covered_members_duplicate_pair` if any pair repeats — the
admin-side counterpart Server Action that later mutates
covered_members applies the same check). Owner is therefore
ALWAYS present at signup with `relationship='self'` and a
known DOB, which is what §4.7 step 4 looks up; no
implicit-owner branch is needed in the consume RPC.

### §4.9 — `admin_activate_subscription` (PR 2)

NEW — admin-only path for Phase 12 (before Phase 14 wires
HyperPay). Flips `status` from `'pending_payment'` to
`'active'`, sets `start_date=NOW()` + `end_date=NOW() + INTERVAL '1 year'`,
+ `next_renewal_due=end_date - INTERVAL '30 days'`.

### §4.10 — `admin_read_medevac_request_detail` (PR 1)

NEW — Round 6 PR #75 P1 #2 fix. Atomic admin PII read +
`admin_pii_read` audit in one SECURITY DEFINER contract so
the audit-before-read claim is database-enforced.

**Signature:**

```sql
admin_read_medevac_request_detail(
  p_request_id        UUID,
  p_session_metadata  JSONB  -- {cookie_expiry, cookie_fingerprint}
) RETURNS JSON
```

**Steps** (single statement-level transaction; any RAISE
EXCEPTION aborts the call and reverts the audit insert):

0. **Fail-closed metadata guard** (Round 7 PR #75 P1 #1
   fix). Before the audit insert OR the PII select, the RPC
   MUST verify that `p_session_metadata` carries both
   fields and that each is a non-empty string:

   ```sql
   IF p_session_metadata IS NULL
      OR (p_session_metadata->>'cookie_expiry') IS NULL
      OR length(BTRIM(p_session_metadata->>'cookie_expiry')) = 0
      OR (p_session_metadata->>'cookie_fingerprint') IS NULL
      OR length(BTRIM(p_session_metadata->>'cookie_fingerprint')) = 0
   THEN
     RETURN json_build_object(
       'ok', false,
       'error', 'admin_session_metadata_required'
     );
   END IF;
   ```

   This is the database-side counterpart to the TS helper's
   env guard (see ENV addition below). It blocks the path
   where a future caller refactor or a test harness passes
   `'{}'::jsonb` and would otherwise produce an audit row
   with `cookie_expiry=NULL` + `cookie_fingerprint=NULL`,
   leaving the PII read effectively unattributable. The
   guard returns the structured error WITHOUT writing any
   audit row — the RPC never reached the privileged read,
   so there's nothing to attribute.

1. **INSERT the audit row first** so a SELECT failure can
   never expose PII unaudited:
   ```sql
   INSERT INTO audit_logs (
     entity_type, entity_id, action, new_value, user_id
   ) VALUES (
     'medevac_request',
     p_request_id,
     'admin_pii_read',
     jsonb_build_object(
       'mev_number', (SELECT medevac_request_number
                        FROM medevac_requests
                       WHERE id = p_request_id),
       'service_level', (SELECT service_level
                           FROM medevac_requests
                          WHERE id = p_request_id),
       'condition_severity', (SELECT condition_severity
                                FROM medevac_requests
                               WHERE id = p_request_id),
       'cookie_expiry', p_session_metadata->>'cookie_expiry',
       'cookie_fingerprint', p_session_metadata->>'cookie_fingerprint'
     ),
     NULL  -- Round 6 PR #75 P1 #1 fix: admin auth is cookie,
           -- not a users.id; user_id MUST be NULL here.
   );
   ```
   The metadata sub-selects against `medevac_requests` first
   so the audit row reflects the actual MEV-XXXX even if the
   later SELECT returns nothing (e.g. caller passed an
   unknown UUID — the audit still captures the access
   attempt; the SELECT then returns `{ok: false, error:
   'request_not_found'}`).
2. **SELECT** the full row including
   `patient_name_snapshot` + `patient_age_snapshot` (the
   PII payload the page renders) plus everything the
   detail view needs. Wrap in a `row_to_json(...)`.
3. **Return** `json_build_object('ok', true, 'request',
   $row_json, 'audit_logged_at', NOW())`. If the row was
   not found, return `{ok: false, error: 'request_not_found'}`
   — the audit row from step 1 stays because the function
   ran to completion.

**Authorisation:** `SECURITY DEFINER` + `REVOKE ALL ON
FUNCTION ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE
... TO service_role;` (Phase 9 convention #1). The TS helper
calls via `createAdminClient()` which uses the service role.
There is no JWT identity inside the RPC; the caller's
authority is the service-role key plus the cookie session
metadata the helper passes through.

**ENV addition:** PR 1 deployment runbook MUST set
`ADMIN_AUDIT_FINGERPRINT_SECRET` (random 32-byte hex) so
the helper can compute `cookie_fingerprint`. The secret
NEVER appears in audit_logs — only the HMAC output.

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
| 26 | RPC `admin_read_medevac_request_detail` (§4.10) — Round 6 PR #75 P1 #2 fix; atomic admin PII read + audit | §4.10 |
| 27 | Helper function `safe_parse_date(TEXT) RETURNS DATE` — Round 8 PR #75 P2 #1 fix; used by §4.7 covered_members dob filter + admin covered_members Server Action write-time validator | §3.11 |

**Server Actions** (`app/actions/`):
- `medevac-public.ts`: `submitMedevacRequestPublic` (wraps §4.1)
- `medevac-admin.ts`: `upsertMedicalCertification` (mirrors
  `upsertCargoAircraftCapability`)

**Server-side helpers** (`lib/medevac/`):
- `admin-pii.ts` — D12 PII surface (Round 5 PR #75 P2 #4 fix;
  rewritten in Round 6 PR #75 P1 #1 + P1 #2 fixes; hardened
  in Round 7 PR #75 P1 #1 fix).
  Exports `readAdminMedevacRequestDetail(requestId)` which:
  (1) **fail-closed env guard** — at module load OR at
  function call (cached), assert
  `process.env.ADMIN_AUDIT_FINGERPRINT_SECRET` is a non-empty
  string; if missing/empty, THROW
  `AdminPiiEnvError('ADMIN_AUDIT_FINGERPRINT_SECRET is
  missing or empty')` before any cookie read, RPC call, or
  partial output. The page-level error boundary surfaces a
  generic "admin temporarily unavailable" message — we
  refuse to render PII without a working audit-fingerprint
  pipeline. (1b) **route-param UUID guard** (Round 8 PR #75
  P2 #3 fix) — `if (!isUuid(requestId)) return null;` using
  the shared `lib/utils/uuid.ts` helper (same pattern as
  `lib/cargo/queries/admin-queue.ts` line 53,
  `lib/clients/queries/me-bookings.ts` line 51, etc.).
  Without this, a URL like `/admin/medevac/not-a-uuid`
  flows straight into `.rpc()` and surfaces a raw
  PostgREST/PG `22P02 invalid_input_syntax` cast error;
  the guard short-circuits to the page's standard
  not-found branch instead. Returning `null` (rather than
  throwing) keeps the not-found UX identical to a real
  unknown-UUID query — and crucially avoids writing an
  audit row for a request that never existed. (2) **Read
  the raw cookie value, validate it, then hash the SAME
  raw value** (Round 10 PR #75 P2 #2 fix — the previous
  wording said "HMAC of the verified cookie value" but
  `requireAdminSession()` returns only `{valid, expiry}`,
  not the raw cookie, so an implementer copying that
  sentence literally would have no value to hash):

  ```typescript
  import { cookies } from 'next/headers';
  import { redirect } from 'next/navigation';  // Round 11 PR #75 P2 #1 fix
  import {
    ADMIN_COOKIE_NAME,
    requireAdminSession,
  } from '@/lib/admin/auth';
  import { createHmac } from 'node:crypto';

  const rawCookie = cookies().get(ADMIN_COOKIE_NAME)?.value;
  // requireAdminSession() re-reads and verifies the same
  // cookie via verifyAdminCookieValue() internally + redirects
  // to /admin/login on failure. We rely on that for the
  // primary validity check; the rawCookie variable is the
  // SAME string requireAdminSession just verified, so the
  // HMAC below is over a guaranteed-valid value.
  const session = requireAdminSession();
  if (!rawCookie) {
    // requireAdminSession would already have redirected; this
    // is belt-and-suspenders for the TS narrowing path.
    redirect('/admin/login');
  }
  const cookie_fingerprint = createHmac(
    'sha256',
    process.env.ADMIN_AUDIT_FINGERPRINT_SECRET!
  ).update(rawCookie, 'utf8').digest('hex');
  const cookie_expiry = session.expiry; // unix-seconds
  ```

  Hashing the exact same raw cookie string on every call
  and storing the resulting HMAC in the audit row's
  `cookie_fingerprint` column makes the fingerprint
  reproducible for a given session — re-running the helper
  within the same cookie lifetime produces the same HMAC,
  which is what makes `audit_logs` queryable per-session
  (Round 11 PR #75 P2 #2 fix — the prior wording said
  "the exact same string Postgres later stores," which
  could imply the raw cookie was persisted; the database
  only ever sees the HMAC output, never the cookie
  itself). Rotating `ADMIN_AUDIT_FINGERPRINT_SECRET`
  invalidates the mapping going forward without ever
  exposing the raw cookie. (3) Calls SECURITY DEFINER RPC
  `admin_read_medevac_request_detail(p_request_id => $1,
  p_session_metadata => jsonb_build_object(
    'cookie_expiry', cookie_expiry,
    'cookie_fingerprint', cookie_fingerprint
  ))` via `createAdminClient()`. (4) Returns the RPC's
  `{request, audit_logged_at}` payload to the page. There
  is NO TS-side INSERT of the audit row — the RPC owns both
  the audit write AND the PII select in one transaction.
  If the RPC returns `{ok: false, error:
  'admin_session_metadata_required'}` (which it will only
  ever do if the helper itself was bypassed by a buggy
  caller), the helper re-throws so the page never receives
  PII with a missing-attribution failure mode.
  Also exports `listAdminMedevacRequests()` which is the
  redacted list-view variant that NEVER selects
  `patient_name_snapshot` or `patient_age_snapshot` (D8
  list/index views are PII-free) and writes no audit row.

**Pages:**
- `/medevac` — public intake form (stable only)
- `/admin/medevac` — queue (uses `listAdminMedevacRequests`
  — PII-free)
- `/admin/medevac/[id]` — detail (patient_name admin-only;
  loads via `readAdminMedevacRequestDetail` so the
  `admin_pii_read` audit row fires on every view)
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

> Round 2 PR #75 P2 #6 fix — PR 2 does NOT re-add a
> per-request escalation throttle column. The
> `medevac_requests.sla_escalated_at TIMESTAMPTZ` column is
> owned by PR 1's §3.1 `CREATE TABLE` and is the single
> throttle source consumed by PR 3's `sla-escalation` cron;
> there is no separate `founder_sla_escalated_at` column.

(No new tables and no new columns in PR 2 — only the 5 new
RPCs above. All RPC bodies wrapped in `CREATE OR REPLACE
FUNCTION`; any incidental schema deltas in helper migrations
use `IF NOT EXISTS` / `pg_constraint` guards.)

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

> Round 2 PR #75 P2 #5 fix — the four
> `warning_{30,14,7,1}d_sent_at` columns on
> `aircraft_medical_certifications` are NOT re-added by PR 3.
> They are owned by PR 1's §3.5 `CREATE TABLE` block (added
> there via the Round 1 PR #75 P1 #4 fix). PR 3 only consumes
> them via the `/api/cron/medevac/expire-certifications`
> warning cascade + renewal-reset logic described below.

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
    `certification_expires_at <= NOW() AND (supports_bmt OR
    supports_als OR supports_cct OR supports_repatriation)`.
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

**Round 7 PR #75 P2 #4 fix — inventory expanded to the
actual PR 1 surface.** Mirrors Phase 11 Probe 28's
"every new object exists" pattern but adapted to Phase 12's
larger PR 1 footprint. The probe is a single SQL script that
returns a row per check with `name TEXT` + `ok BOOLEAN`; all
rows MUST be ok=true before the activation flag flips.

**ENUMs (7)** — `pg_type` exists with the expected labels:
1. `medevac_severity`           (3 labels)
2. `medevac_service_level`      (4 labels)
3. `medevac_request_status`     (6 labels, NO `dispatched`)
4. `medevac_offer_status`       (matches cargo shape)
5. `aeris_shield_plan`          (4 labels)
6. `aeris_shield_subscription_status` (5 labels — checks
   that `'pending'` does NOT exist; only `pending_payment`)
7. `medical_certifying_authority` (5 labels)

**Tables + RLS (8 new objects)** — `pg_class` exists +
`pg_class.relrowsecurity = true` for each:
8.  `medevac_requests`
9.  `medevac_offers`
10. `aircraft_medical_certifications`
11. `medevac_severity_sla` (lookup, 3-row seed verified)
12. `medevac_subscription_plan_terms` (lookup, 4-row seed
    verified — Round 4 PR #75 P2 #3 fix made this
    RLS-enabled)
13. `medevac_subscriptions`
14. `aeris_shield_config` (singleton, 1-row seed verified)
15. `medevac_email_alert_status` (singleton, 1-row seed
    verified)

**Constraints (named CHECK + FK)** — every named constraint
in §3.1-§3.9 exists in `pg_constraint`:
16. `medevac_requests_identity_check`
17. `medevac_requests_guest_severity_check`
18. `medevac_requests_covered_status_equiv_check`
    (Round 2 PR #75 P1 #2 fix — two-way equivalence)
19. `medevac_requests_covered_has_subscription_check`
    (Round 2 PR #75 P1 #2 fix — paired with #18)
20. `medevac_requests_accepted_link_check`
21. `medevac_requests_value_positive_check`
22. `medevac_requests_cancellation_reason_length_check`
23. `medevac_requests_subscription_fkey` (ON DELETE RESTRICT)
24. `medevac_subscriptions_date_order_check`
25. `medevac_subscriptions_active_has_dates_check`
    (Round 6 PR #75 P2 #4 fix — allows `cancelled` with
    NULL dates pre-activation)
26. `medevac_subscriptions_events_within_plan_check`
27. `medevac_subscriptions_cancellation_reason_length_check`
28. `bookings_source_discriminator_check` extended to allow
    `'medevac'` (verify via `pg_get_constraintdef`)
29. `bookings_source_offer_check` extended to allow
    `'medevac_offers'` (verify via `pg_get_constraintdef`)

**Trigger (1)** — `pg_trigger` exists for the
`aircraft_medical_certifications` table:
30. `enforce_aircraft_medical_certifications_trigger`
    (Round 3 PR #75 P1 #1 fix — consolidated trigger
    name; the older `reject_past_expiry_trigger` MUST NOT
    exist, since the rule was moved into the trigger body).

**Indexes (8 named across §3.1 + §3.2 + §3.7)** — Round 8
PR #75 P2 #2 fix replaced the placeholder + missing rows
with the exact PR 1 index allowlist; every entry verified
present in `pg_indexes` with the expected `indexdef`:
31. `idx_medevac_requests_client`        (§3.1, partial:
    `WHERE client_id IS NOT NULL`)
32. `idx_medevac_requests_status`        (§3.1)
33. `idx_medevac_requests_severity`      (§3.1, partial:
    `WHERE status IN ('pending', 'offers_received')`)
34. `idx_medevac_requests_sla_pending`   (§3.1, partial
    on `dispatched_at` + `sla_escalated_at IS NULL`)
35. `idx_medevac_offers_request`         (§3.2 — was
    omitted in Round 7's inventory)
36. `idx_medevac_offers_operator`        (§3.2 — was
    omitted in Round 7's inventory)
37. `idx_medevac_subscriptions_client`   (§3.7)
38. `idx_medevac_subscriptions_status`   (§3.7, partial:
    `WHERE status IN ('active', 'pending_payment')`)

`§3.5 aircraft_medical_certifications` has no named CREATE
INDEX (the table's PRIMARY KEY on `aircraft_id` is the only
implicit index — sufficient for the per-aircraft lookup
the PR 3 cron uses).

**RPCs + helper functions (7 in PR 1)** — Round 9 PR #75
P2 #2 fix tightened the ACL probe: for each function the
probe asserts ALL FOUR of
`has_function_privilege('service_role', $oid, 'EXECUTE') =
true`, `has_function_privilege('PUBLIC', $oid, 'EXECUTE')
= false`, `has_function_privilege('anon', $oid,
'EXECUTE') = false`, AND `has_function_privilege(
'authenticated', $oid, 'EXECUTE') = false`. The migration
contract issues `REVOKE ALL ... FROM PUBLIC, anon,
authenticated` but Postgres lets a later migration grant
`anon`/`authenticated` explicitly without touching the
`PUBLIC` ACL, so the prior 2-check shape couldn't catch a
drift that re-exposed the function to anon/authenticated.
`pg_proc` existence is checked alongside, as before:
39. `create_medevac_request_guest`         (§4.1)
40. `create_medevac_request_authenticated` (§4.2)
41. `submit_medevac_offer`                  (§4.3)
42. `consume_aeris_shield_event`            (§4.7)
43. `subscribe_to_aeris_shield`             (§4.8) — note:
    inventory item #25 (PR 1) but RPC ships in PR 1
    migration per §5; the page that calls it ships in PR 2.
44. `admin_read_medevac_request_detail`    (§4.10 — Round 6
    PR #75 P1 #2 fix; Round 7 PR #75 P1 #1 fix adds the
    fail-closed metadata guard.)
45. `safe_parse_date(TEXT)`                (§3.11 — Round
    8 PR #75 P2 #1 fix; used by §4.7 covered_members dob
    filter + admin covered_members Server Action write-time
    validator. Verify it's `IMMUTABLE` + `PARALLEL SAFE`
    via `pg_proc.provolatile = 'i'` +
    `pg_proc.proparallel = 's'`.)

**Env vars (1 new in PR 1)** — Round 7 PR #75 P2 #2 fix:
46. `ADMIN_AUDIT_FINGERPRINT_SECRET` env exists, is a
    non-empty string of ≥ 32 hex chars. Check via a small
    Server Action probe endpoint that returns a sanitised
    boolean (NEVER the value itself). Without this var the
    admin PII helper fail-closes (Round 7 PR #75 P1 #1
    fix), so probe 33 MUST verify it before the activation
    flag flips. `CRON_SECRET` and `ENABLE_MEDEVAC` are
    NOT checked here (PR 3 and the §7 runbook own those).

**Total: 46 named checks** (Round 8 PR #75 P2 #2 fix —
+2 indexes from §3.2 + 1 helper function from §3.11; the
RPC + env-var rows shifted accordingly). All MUST pass
before the activation flag flip in §7 step 3.

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
4. Verify `/me/bookings` chip shows "إخلاء طبي" rendered with
   the **rose** Tailwind palette (`bg-rose-50`, `text-rose-700`,
   `border-rose-200` light mode; `bg-rose-500/15`,
   `text-rose-300`, `border-rose-500/30` dark mode). Round 3
   PR #75 P2 #6 fix — decision locked: medevac is the only
   medical-urgent product, so the chip MUST visually
   differentiate from charter (gold), empty-legs (emerald),
   and cargo (slate). Probe 36 fails if the chip uses any
   other palette.

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
   `certification_expires_at = NOW() + INTERVAL '7 days'`
   and at least one `supports_*` flag TRUE. (Round 2 PR #75
   P2 #4 fix — the §3.5 `reject_past_expiry_trigger` BEFORE
   INSERT path rejects past timestamps with SQLSTATE 22023,
   so we MUST insert a future cert first.)
2. UPDATE the same row to set
   `certification_expires_at = NOW() - INTERVAL '1 day'`
   WITHOUT touching any `supports_*` flag. (The trigger's
   UPDATE branch only blocks RE-ENABLING a flag on an expired
   cert; backdating the timestamp on a row whose flags are
   already TRUE is the intended admin path for simulating
   expiry in probes + tests.)
3. Trigger `/api/cron/medevac/expire-certifications`.
4. Verify all `supports_*` flipped to `false`.

---

## §7 Acceptance + activation runbook

### Codex review checkpoint
- [ ] Spec PR reaches Codex 100/100 (this document)
- [ ] PR 1 reaches Codex 100/100 (backend + intake + admin)
- [ ] PR 2 reaches Codex 100/100 (authed + offer/booking + subs)
- [ ] PR 3 reaches Codex 100/100 (distribution + cron + canary)

### Production activation (per spec §10 of Phase 11 cargo)

0. **Provision PR 1 secrets BEFORE applying the migration**
   (Round 7 PR #75 P2 #2 fix — the previous runbook only
   listed `ENABLE_MEDEVAC` and `CRON_SECRET`, missing the
   new admin audit fingerprint secret):
   - `ENABLE_MEDEVAC=false` (set to false initially per
     step 2 below; the var must exist).
   - `ADMIN_AUDIT_FINGERPRINT_SECRET` — generate a fresh
     random hex value (`openssl rand -hex 32`) and store it
     via the Vercel "Environment Variables → Production"
     UI. The admin PII helper fail-closes if this is
     missing/empty (Round 7 PR #75 P1 #1 fix), so PR 1's
     `/admin/medevac/[id]` page will refuse to render
     until it's set. Re-using a previously generated
     fingerprint secret across environments is fine; the
     value never appears in audit logs or HTTP responses.
   - `CRON_SECRET` is NOT required for PR 1 (no cron
     entries ship yet — that's PR 3's runbook step 4).
1. Apply PR 1 migration. Run Probe 33 (schema +
   constraints + RLS + RPCs + GRANTs + the new env-var
   sub-check #46 — Round 9 PR #75 P2 #3 fix; the env-var
   row moved from #44 to #46 after Round 8 added 2 missing
   `idx_medevac_offers_*` rows + the `safe_parse_date`
   helper function) + Probe 34 (guest path).
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

Spec under active Codex review; see the table below for
the current resolved-round ledger. (Round 16 PR #75 P2 #1
fix retired the per-round rolling wording — every previous
round had to update the prior round's "in progress" line,
which was itself stale by the next review. The table is
now the single source of truth; the latest row is the most
recently resolved round.) Each round's fix commits are
squash-mergeable on top of the round-0 draft; inline
`Round N PR #75 [P1/P2] #M fix` citations throughout this
document point back to the row below.

| Round | Findings | Severity mix | Resolved at |
|---|---|---|---|
| 0 | (initial draft, 969 lines) | — | `c7d6f29` |
| 1 | 8 (per-actor PII, covered invariant, sub FK, cert-expiry cascade, Shield operator gates, severity ENUM, PR inventory exactness, probes summary) | 5 P1 + 3 P2 | `958dd02` |
| 2 | 6 (sub dates nullable, two-way covered equivalence, payment_status, Probe 40 reword, PR 3 cert ownership, PR 2 sla_escalated) | 3 P1 + 3 P2 | `38cea14` |
| 3 | 6 (cert at-least-one trigger, PL/pgSQL no ROLLBACK, Shield service-level matrix, client_id RESTRICT, email_alert DDL, Probe 36 chip lock) | 4 P1 + 2 P2 | `ed79525` |
| 4 | 4 (repat matrix gap, consume bound to caller+member, plan_terms RLS, D11 30-day reset) | 2 P1 + 2 P2 | `8f5a74e` |
| 5 | 4 (J3 status, canonical name preserved, D4 enum rename, admin_pii_read owner) | 1 P1 + 3 P2 | `a0f14ad` |
| 6 | 4 (admin user_id=NULL + fingerprint, atomic PII RPC, (name,dob) match, cancelled NULL dates) | 3 P1 + 1 P2 | `941442f` |
| 7 | 4 (fail-closed metadata guard, runbook ENV, dob regex, Probe 33 inventory) | 1 P1 + 3 P2 | `723464b` |
| 8 | 3 (safe_parse_date helper, Probe 33 indexes, isUuid guard) | 0 P1 + 3 P2 | `e6def87` |
| 9 | 3 (INT age cast + future-DOB guard, ACL probe anon/authenticated, runbook #46 ref) | 1 P1 + 2 P2 | `501746d` |
| 10 | 2 (D8 admin list PII-free vs detail audited, helper raw-cookie sequence) | 1 P1 + 1 P2 | `113577b` |
| 11 | 2 (snippet redirect import, fingerprint privacy wording) | 0 P1 + 2 P2 | `82922d5` |
| 12 | 1 (§4 RPC intro staleness) | 0 P1 + 1 P2 | `69101be` |
| 13 | 1 (spec-header + review-history staleness) | 0 P1 + 1 P2 | `745cc64` |
| 14 | 1 (status wording rolled over to "1-13 resolved / 14 in progress") | 0 P1 + 1 P2 | `85f872f` |
| 15 | 1 (same lag-by-one — status rolled to "1-14 resolved / 15 pending") | 0 P1 + 1 P2 | `dc0a1e9` |
| 16 | 1 (retired the per-round rolling wording entirely; header + §8 intro now point at this table — this row) | 0 P1 + 1 P2 | (this commit) |

**Aggregate to date:** 51 findings closed (21 P1 + 30 P2)
across 16 rounds; 0 outstanding P1.
