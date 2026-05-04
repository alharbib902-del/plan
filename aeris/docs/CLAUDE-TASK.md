# Claude Task

## Current Phase

Phase 4: Minimal Operator Portal

## Status

Iteration 4 of the draft. **Awaiting Codex review.** No
implementation yet.

Iteration history:

- **Iteration 1 (2026-05-04, 82/100, not accepted).** Codex
  flagged three blocking schema-conflict findings: `client_id NOT
  NULL` blocked guest promotion, `offers.operator_id`/`aircraft_id
  NOT NULL` blocked free-text submission, and the English-only
  state labels (`open|dispatched|confirmed|declined`) did not
  exist in the actual enums.
- **Iteration 2 (2026-05-04, 92/100, not accepted).** All three
  iteration-1 findings resolved structurally. Codex flagged two
  new P1 findings plus one P2: promotion was allowed via
  sequential `await supabase.from(...)` calls (partial-application
  risk), `accept_phase4_offer` did not check `expires_at` (an
  expired pending offer could be accepted), and the
  `SECURITY DEFINER` function omitted `SET search_path` (schema
  hijacking risk against unqualified table references).
- **Iteration 3 (2026-05-04, 96/100, not accepted).** All three
  iteration-2 findings resolved. §1e split into §1e-1 (new
  `promote_lead_to_trip_request(...)`) and §1e-2 (updated
  `accept_phase4_offer(...)` with `expires_at` guard +
  auto-`'expired'` flip). Both pin `SET search_path = public,
  pg_temp`. §2 calls the new RPC and forbids sequential calls.
  Codex flagged one final P1: `submitOperatorOffer` still wrote
  the offer row and updated trip status as two sequential
  Supabase calls — partial-state risk and a re-dispatch race
  window between Server-Action token validation and the insert.
- **Iteration 4 (this draft).** Iteration-3 finding resolved.
  §1e-3 adds a third RPC, `submit_phase4_operator_offer(...)`,
  that locks `trip_requests FOR UPDATE`, atomically re-verifies
  `dispatch_nonce` / `dispatch_expires_at` against the token's
  payload, inserts the offer, and conditionally promotes the trip
  status — all in one transaction. §5 now invokes that RPC and
  bans sequential calls. Acceptance criterion #2 covers all three
  functions; criterion #7 strengthens the atomic-submit check;
  new criterion #7a verifies the re-dispatch race guard.

Match against ground truth in
`supabase/migrations/20260422000001_initial_schema.sql` and
`supabase/migrations/20260425000002_lead_inquiries.sql` is
preserved from iteration 2.

## Objective

Ship the smallest cohesive vertical slice that turns a Phase 2 lead
inquiry into a confirmed booking via an operator's offer:

1. Admin **promotes** a lead inquiry into a real `trip_requests`
   row (with a customer snapshot, no real client account yet).
2. Admin **dispatches** the trip request to one operator via a
   signed, time-limited URL pasted into WhatsApp.
3. Operator opens the URL (no login), reviews the request, and
   **submits an offer** that is stored in a new
   `phase4_operator_offers` table (separate from the structured
   `offers` table to avoid forcing fake `operator_id`/`aircraft_id`
   foreign keys).
4. Admin views offers on the trip request page and **accepts one**;
   a single SQL transaction marks that offer accepted, all sibling
   offers rejected, and the trip request booked.

That is the entire user-visible flow. Notifications back to the
client, automated multi-operator distribution, payments, real
operator authentication, mobile, empty-legs marketplace, loyalty,
MedEvac, and Cargo are all out of scope.

## Business Goal

Phase 1 produced the public site. Phase 2 captured leads. Phase 3 /
3.5 / 3.5.1 hardened the deploy chain. Phase 4 is the first phase
that produces **billable transactions**: a closed-loop
request → offer → accept flow that uses real human operators
reachable on WhatsApp without forcing them into a self-service
portal yet. The goal is to close the first 5-10 bookings end-to-end
without writing the full operator marketplace.

The flow is intentionally founder-mediated: every dispatch and every
acceptance is a deliberate admin click. This trades automation for
control during the period when the operator network is being formed.
Automated distribution becomes Phase 5 once we have data on which
operators consistently respond, at what price band, and how
quickly.

## Schema Reality (read first)

The following is the **actual** state of the schema as of the
Phase 3.5.1 baseline. Phase 4 must be designed against these
definitions, not against assumed ones.

### `trip_requests` (initial schema)

```sql
client_id UUID NOT NULL REFERENCES users(id)        -- BLOCKER for guest leads
trip_type trip_type NOT NULL DEFAULT 'charter'      -- enum: charter|empty_leg|medevac|cargo
legs JSONB NOT NULL                                 -- array of { from, to, date, time }
departure_airport VARCHAR(10) REFERENCES airports(iata_code)
arrival_airport VARCHAR(10) REFERENCES airports(iata_code)
departure_date TIMESTAMPTZ NOT NULL
return_date TIMESTAMPTZ
passengers_count INTEGER NOT NULL CHECK (1..19)
aircraft_category_preference aircraft_category      -- enum: light|mid|super_mid|heavy|long_range
special_requests TEXT
preferences JSONB DEFAULT '{}'::jsonb
status trip_request_status DEFAULT 'pending'        -- enum: pending|distributed|offered|booked|cancelled
distributed_to UUID[] DEFAULT ARRAY[]::UUID[]
distributed_at TIMESTAMPTZ
```

### `offers` (initial schema, **NOT directly used by Phase 4**)

```sql
operator_id UUID NOT NULL REFERENCES operators(id)  -- BLOCKER: no operator records
aircraft_id UUID NOT NULL REFERENCES aircraft(id)   -- BLOCKER: no aircraft records
base_price, vat_amount, total_price DECIMAL
validity_minutes INTEGER DEFAULT 120
status offer_status DEFAULT 'pending'               -- enum: pending|viewed|accepted|rejected|expired
expires_at TIMESTAMPTZ
```

### `lead_inquiries` (Phase 2)

```sql
customer_name, customer_phone     -- snapshot fields, no FK
trip_type lead_trip_type          -- enum: one_way|round_trip|multi_city  (DIFFERENT enum)
origin, destination, departure_date, return_date, passengers, notes
status lead_status                -- enum: new|contacted|quoted|converted|closed
```

### Status mapping that Phase 4 uses (no enum changes)

| Phase 4 concept | DB column / enum value |
|---|---|
| Trip "open / awaiting dispatch" | `trip_requests.status = 'pending'` |
| Trip "dispatched to operator, link sent" | `trip_requests.status = 'distributed'` |
| Trip "at least one offer received" | `trip_requests.status = 'offered'` |
| Trip "operator accepted, offer locked" | `trip_requests.status = 'booked'` |
| Offer "submitted, awaiting decision" | `phase4_operator_offers.status = 'pending'` |
| Offer "founder accepted" | `phase4_operator_offers.status = 'accepted'` |
| Offer "founder rejected (or sibling of accepted)" | `phase4_operator_offers.status = 'rejected'` |
| Offer "validity expired before decision" | `phase4_operator_offers.status = 'expired'` |

`phase4_operator_offers.status` reuses the existing
`offer_status` enum (`pending|viewed|accepted|rejected|expired`).
No new enum is introduced anywhere in Phase 4.

### Trip-type mapping from lead → trip_request (Codex iteration 1, fix #4)

`lead_trip_type` (`one_way|round_trip|multi_city`) and `trip_type`
(`charter|empty_leg|medevac|cargo`) are **different** enums that
mean different things. Promotion does NOT copy across them.

- Phase 4 always sets `trip_requests.trip_type = 'charter'` (the
  only product the minimal portal sells).
- The original `lead_trip_type` is preserved by storing it inside
  `trip_requests.preferences->'lead_trip_type'` (text) so it can be
  surfaced in the admin UI without polluting the `trip_type`
  column.
- The `legs JSONB` array is constructed from the lead's
  `origin / destination / departure_date` (and `return_date` if
  present), producing one or two leg objects of the shape
  `{ from, to, date, time: null }`. Multi-city leads (lead_trip_type
  = 'multi_city') in Phase 4 promote with a single leg plus a
  warning in the admin UI that multi-city must be edited manually
  before dispatch — a Phase 4.1 task adds the leg editor.

## Scope

### 1. Phase 4 migration (schema + RLS) — REQUIRED

A single new migration file:
`supabase/migrations/20260504000003_phase_4_operator_portal.sql`.

#### 1a. Loosen `trip_requests` for guest-originated requests

- `ALTER TABLE trip_requests ALTER COLUMN client_id DROP NOT NULL;`
- Add customer snapshot columns:
  - `customer_name VARCHAR(120)`
  - `customer_phone VARCHAR(20)`
  - `customer_source VARCHAR(40) DEFAULT 'lead'` — for future
    distinction between `'lead'`, `'walk_in'`, etc.
- Add a constraint that guarantees identity exists in *some* form:
  `CHECK (client_id IS NOT NULL OR (customer_name IS NOT NULL AND customer_phone IS NOT NULL))`.
- Add dispatch tracking columns (single active dispatch at a time;
  re-dispatch overwrites):
  - `dispatch_nonce TEXT` (nullable, unique-per-trip enforced in
    application code, not via DB unique to keep re-dispatch easy).
  - `dispatch_expires_at TIMESTAMPTZ` (nullable).
  - `dispatch_target_phone VARCHAR(20)` (nullable, the WhatsApp
    number the founder pasted).
  - `dispatched_at TIMESTAMPTZ` (nullable, set on dispatch action).
- No new index unless the work log argues for one in a follow-up.

#### 1b. Add `lead_inquiries.converted_at`

`ALTER TABLE lead_inquiries ADD COLUMN converted_at TIMESTAMPTZ;`
No index needed; the existing `(status, created_at DESC)` index
covers admin-UI filtering. Promotion sets this column to `NOW()`.

#### 1c. `phase4_operator_offers` table (new, snapshot-style)

Mirrors `lead_inquiries`'s deny-all-RLS pattern. Snapshot columns
because no `operators` or `aircraft` rows exist yet.

```sql
CREATE TABLE phase4_operator_offers (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trip_request_id          UUID NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,

  -- Operator snapshot (free text per Codex iteration 1, decision #4)
  operator_name            VARCHAR(120) NOT NULL,
  operator_phone           VARCHAR(20),
  operator_email           VARCHAR(120),

  -- Aircraft snapshot
  aircraft_category        aircraft_category,         -- reuse existing enum
  aircraft_type            VARCHAR(80),                -- e.g., "Gulfstream G650"
  aircraft_registration    VARCHAR(20),                -- e.g., "HZ-XYZ"

  -- Pricing (single total field; VAT split deferred to Phase 5)
  total_price_sar          DECIMAL(12,2) NOT NULL CHECK (total_price_sar >= 1000),

  -- Schedule
  departure_eta            TIMESTAMPTZ NOT NULL,
  validity_hours           INTEGER NOT NULL DEFAULT 24 CHECK (validity_hours BETWEEN 1 AND 168),
  expires_at               TIMESTAMPTZ NOT NULL,

  -- Notes
  notes                    TEXT,

  -- State
  status                   offer_status NOT NULL DEFAULT 'pending',
  decided_at               TIMESTAMPTZ,

  -- Provenance (which dispatch nonce produced this submission)
  source_dispatch_nonce    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_phase4_offers_trip ON phase4_operator_offers(trip_request_id, created_at DESC);
CREATE INDEX idx_phase4_offers_status ON phase4_operator_offers(status, created_at DESC);

CREATE TRIGGER phase4_operator_offers_updated_at BEFORE UPDATE ON phase4_operator_offers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE phase4_operator_offers ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies → anon + authenticated cannot SELECT/INSERT/UPDATE/DELETE.
-- All access goes through the service role from validated Server Actions, matching
-- the lead_inquiries pattern from migration 20260425000002.

COMMENT ON TABLE phase4_operator_offers IS
  'Phase 4: free-text operator submissions via signed token URL. Server-only access.';
```

#### 1d. RLS audit on `trip_requests`

`trip_requests` already has `relrowsecurity = true` from the initial
schema. Phase 4 reads/writes `trip_requests` from Server Actions
guarded by `requireAdminSession()` using the **service role
client**, which bypasses RLS just like Phase 2. No `trip_requests`
RLS policy changes are required for Phase 4.

If, while implementing, the audit reveals that the existing
`trip_requests_select_own` / `trip_requests_insert_own` policies
would *grant* unintended access to the new customer snapshot fields
when client-side reads happen later, that is a Phase 5 concern;
record the finding in the work log but do not change those policies
in Phase 4.

#### 1e. Atomic SQL functions (promote + accept)

Two `SECURITY DEFINER` PL/pgSQL functions encapsulate every
multi-statement state change Phase 4 makes. Both functions:

- Run inside a single transaction with row-level `FOR UPDATE`
  locks on the rows they mutate, so partial application and
  two-admin races are impossible (Codex iteration 1, fix #6 +
  iteration 2, fix #1).
- Pin `SET search_path = public, pg_temp` so an attacker who can
  create objects in another schema cannot hijack the unqualified
  table references inside a `SECURITY DEFINER` body (Codex
  iteration 2, fix #3).
- Are owned by `postgres`, revoked from `PUBLIC`, granted only to
  `service_role`. Server Actions invoke them via
  `supabase.rpc(...)`.

##### 1e-1. `promote_lead_to_trip_request(...)` — guest lead → trip in one transaction (Codex iteration 2, fix #1)

```sql
CREATE OR REPLACE FUNCTION promote_lead_to_trip_request(
  p_lead_id              UUID,
  p_legs                 JSONB,
  p_aircraft_category    aircraft_category,
  p_special_requests     TEXT,
  p_lead_trip_type       TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead    RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_trip_id UUID;
BEGIN
  -- Lock the lead row to serialize concurrent promote attempts.
  SELECT * INTO v_lead
    FROM lead_inquiries
    WHERE id = p_lead_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  IF v_lead.status NOT IN ('new', 'contacted', 'quoted') THEN
    RETURN json_build_object('ok', false, 'error', 'lead_not_promotable');
  END IF;

  -- Insert the trip request (guest origin: client_id = NULL,
  -- customer snapshot fields populated; check constraint
  -- trip_requests_identity_check is satisfied).
  INSERT INTO trip_requests (
    client_id, customer_name, customer_phone, customer_source,
    trip_type, legs,
    departure_date, return_date, passengers_count,
    aircraft_category_preference, special_requests,
    preferences, status
  ) VALUES (
    NULL,
    v_lead.customer_name, v_lead.customer_phone, 'lead',
    'charter', p_legs,
    v_lead.departure_date::timestamptz,
    v_lead.return_date::timestamptz,
    v_lead.passengers,
    p_aircraft_category, p_special_requests,
    jsonb_build_object('lead_trip_type', p_lead_trip_type),
    'pending'
  )
  RETURNING id INTO v_trip_id;

  -- Mark the lead converted in the same transaction.
  UPDATE lead_inquiries
    SET status = 'converted', converted_at = v_now
    WHERE id = p_lead_id;

  RETURN json_build_object('ok', true, 'trip_request_id', v_trip_id);
END;
$$;

REVOKE ALL ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION promote_lead_to_trip_request(
  UUID, JSONB, aircraft_category, TEXT, TEXT
) TO service_role;
```

##### 1e-2. `accept_phase4_offer(...)` — accept with expiry guard (Codex iteration 2, fix #2)

```sql
CREATE OR REPLACE FUNCTION accept_phase4_offer(
  p_offer_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trip_id UUID;
  v_now     TIMESTAMPTZ := NOW();
BEGIN
  -- Lock the offer row AND require it still be valid.
  -- Phase 4 has no background job that flips expired offers to
  -- 'expired' on a schedule, so the guard MUST live here.
  SELECT trip_request_id INTO v_trip_id
    FROM phase4_operator_offers
    WHERE id = p_offer_id
      AND status = 'pending'
      AND expires_at > v_now
    FOR UPDATE;

  IF v_trip_id IS NULL THEN
    -- Distinguish "expired" from "not pending" so the UI can give
    -- a useful error message; flip an expired offer to 'expired'
    -- in the same transaction so it stops appearing as pending.
    PERFORM 1
      FROM phase4_operator_offers
      WHERE id = p_offer_id
        AND status = 'pending'
        AND expires_at <= v_now
      FOR UPDATE;
    IF FOUND THEN
      UPDATE phase4_operator_offers
        SET status = 'expired', decided_at = v_now
        WHERE id = p_offer_id AND status = 'pending';
      RETURN json_build_object('ok', false, 'error', 'offer_expired');
    END IF;
    RETURN json_build_object('ok', false, 'error', 'offer_not_pending');
  END IF;

  -- Trip must still be in a state that can be booked.
  PERFORM 1 FROM trip_requests
    WHERE id = v_trip_id
      AND status IN ('pending', 'distributed', 'offered')
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_open');
  END IF;

  -- Flip the chosen offer.
  UPDATE phase4_operator_offers
    SET status = 'accepted', decided_at = v_now
    WHERE id = p_offer_id;

  -- Reject every other pending sibling on the same trip.
  UPDATE phase4_operator_offers
    SET status = 'rejected', decided_at = v_now
    WHERE trip_request_id = v_trip_id
      AND id <> p_offer_id
      AND status = 'pending';

  -- Book the trip.
  UPDATE trip_requests
    SET status = 'booked'
    WHERE id = v_trip_id;

  RETURN json_build_object('ok', true, 'trip_request_id', v_trip_id);
END;
$$;

REVOKE ALL ON FUNCTION accept_phase4_offer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_phase4_offer(UUID) TO service_role;
```

##### 1e-3. `submit_phase4_operator_offer(...)` — operator submission with re-dispatch race guard (Codex iteration 3, fix #1)

The Server Action's pre-RPC token validation in §5 is **necessary
but not sufficient**: between the moment the Server Action verifies
the token and the moment the offer row is inserted, the founder
could re-dispatch the trip and overwrite `dispatch_nonce` /
`dispatch_expires_at`. A naive insert would then write an offer
attributed to a link the founder has just invalidated. Wrapping the
trip lookup, the nonce/expiry re-check, the offer insert, and the
trip status promotion in one RPC closes that window.

```sql
CREATE OR REPLACE FUNCTION submit_phase4_operator_offer(
  p_token_trip_id          UUID,
  p_token_nonce            TEXT,
  p_operator_name          TEXT,
  p_operator_phone         TEXT,
  p_operator_email         TEXT,
  p_aircraft_category      aircraft_category,
  p_aircraft_type          TEXT,
  p_aircraft_registration  TEXT,
  p_total_price_sar        DECIMAL,
  p_departure_eta          TIMESTAMPTZ,
  p_validity_hours         INTEGER,
  p_notes                  TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trip      RECORD;
  v_now       TIMESTAMPTZ := NOW();
  v_offer_id  UUID;
BEGIN
  -- Lock the trip and atomically re-verify dispatch state.
  -- This closes the window between the Server Action's token
  -- validation and the offer insert: a re-dispatch that overwrote
  -- the nonce/expiry between those two points causes this guard
  -- to fail with 'token_stale', not a silently-attributed insert.
  SELECT id, dispatch_nonce, dispatch_expires_at, status
    INTO v_trip
    FROM trip_requests
    WHERE id = p_token_trip_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'error', 'trip_not_found');
  END IF;

  IF v_trip.status IN ('booked', 'cancelled') THEN
    RETURN json_build_object('ok', false, 'error', 'trip_closed');
  END IF;

  IF v_trip.dispatch_nonce IS DISTINCT FROM p_token_nonce
     OR v_trip.dispatch_expires_at IS NULL
     OR v_trip.dispatch_expires_at <= v_now THEN
    RETURN json_build_object('ok', false, 'error', 'token_stale');
  END IF;

  -- Insert the offer (status defaults to 'pending'; spelled
  -- explicitly for clarity, identical effect).
  INSERT INTO phase4_operator_offers (
    trip_request_id,
    operator_name, operator_phone, operator_email,
    aircraft_category, aircraft_type, aircraft_registration,
    total_price_sar,
    departure_eta, validity_hours, expires_at,
    notes,
    status, source_dispatch_nonce
  ) VALUES (
    p_token_trip_id,
    p_operator_name, p_operator_phone, p_operator_email,
    p_aircraft_category, p_aircraft_type, p_aircraft_registration,
    p_total_price_sar,
    p_departure_eta, p_validity_hours,
    v_now + (p_validity_hours * INTERVAL '1 hour'),
    p_notes,
    'pending', p_token_nonce
  )
  RETURNING id INTO v_offer_id;

  -- Promote trip status only if it is still in an early state.
  -- A subsequent offer must not regress 'offered' → 'offered'
  -- repeatedly (no-op anyway), and must not touch 'booked'.
  IF v_trip.status IN ('pending', 'distributed') THEN
    UPDATE trip_requests
      SET status = 'offered'
      WHERE id = p_token_trip_id;
  END IF;

  RETURN json_build_object('ok', true, 'offer_id', v_offer_id);
END;
$$;

REVOKE ALL ON FUNCTION submit_phase4_operator_offer(
  UUID, TEXT, TEXT, TEXT, TEXT,
  aircraft_category, TEXT, TEXT,
  DECIMAL, TIMESTAMPTZ, INTEGER, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION submit_phase4_operator_offer(
  UUID, TEXT, TEXT, TEXT, TEXT,
  aircraft_category, TEXT, TEXT,
  DECIMAL, TIMESTAMPTZ, INTEGER, TEXT
) TO service_role;
```

The Server Actions in §2, §5, and §6 invoke these via
`supabase.rpc('promote_lead_to_trip_request', { ... })`,
`supabase.rpc('submit_phase4_operator_offer', { ... })`, and
`supabase.rpc('accept_phase4_offer', { p_offer_id })` respectively.
**Direct sequential `await supabase.from(...)` calls are NOT
acceptable for any of the three actions** — the RPC call is the
contract.

### 2. Lead promotion (admin Server Action + UI)

UI: on `/admin/leads/[id]`, add a section labelled
**"تحويل إلى طلب رحلة"** (Promote to trip request). Form fields
the lead does *not* already provide:

- **Cabin class** (required) — bound to
  `trip_requests.aircraft_category_preference`. Enum values shown
  in Arabic but stored as the existing English keys
  (`light|mid|super_mid|heavy|long_range`).
- **Special requirements** (optional, free text) — stored in
  `trip_requests.special_requests`.
- **Note for multi-city leads** — if `lead_inquiries.trip_type =
  'multi_city'`, render an inline warning that the legs JSON will
  be created with the single primary leg only and the founder must
  edit it manually before dispatch (a Phase 4.1 leg editor is
  out of scope here).

Submit button: **"تأكيد التحويل"** (Confirm conversion).

Server Action `promoteLeadToTripRequest(leadId, formData)`:

- `requireAdminSession()`.
- Validates with Zod (cabin class enum, optional notes).
- Loads the lead row; aborts if `status NOT IN ('new', 'contacted', 'quoted')`.
- Builds the `legs` array:
  - `lead_trip_type = 'one_way'` →
    `[{ from, to, date: departure_date, time: null }]`.
  - `lead_trip_type = 'round_trip'` →
    `[{ from, to, date: departure_date, time: null },
       { from: to, to: from, date: return_date, time: null }]`.
  - `lead_trip_type = 'multi_city'` → same as `one_way`, plus the
    warning in the work log + UI noted above.
- Invokes the `promote_lead_to_trip_request(...)` RPC defined in
  §1e-1, passing:
  - `p_lead_id` = `leadId`
  - `p_legs` = the built legs JSON (one or two leg objects per the
    `lead_trip_type` mapping above)
  - `p_aircraft_category` = the form's cabin class
  - `p_special_requests` = the form's notes (or `NULL`)
  - `p_lead_trip_type` = `lead.trip_type::text` (preserved verbatim
    inside the trip request's `preferences->lead_trip_type` by the
    function body)
- The RPC returns `{ ok: true, trip_request_id }` on success or
  `{ ok: false, error: 'lead_not_found' | 'lead_not_promotable' }`
  on the two race / state-mismatch conditions. The Server Action
  surfaces failure as an Arabic-RTL inline error and leaves the
  lead untouched (the RPC's `FOR UPDATE` lock guarantees this).
- On success, redirects to `/admin/trips/[id]`.
- **Sequential `await supabase.from(...)` calls are NOT acceptable
  for this action** (Codex iteration 2, fix #1). Partial application
  — trip inserted, lead update fails — would leave the system in a
  state where the same lead can be re-promoted indefinitely.
  The single-RPC contract makes that impossible.

### 3. Admin trip-requests list + detail

- `/admin/trips` — list page modelled on `/admin/leads`. Columns:
  request number (`AER-XXXX`), customer name + phone (from snapshot
  columns; show "—" if `client_id` is set instead), route (built
  from `legs[0].from` → last leg's `to`), departure date,
  status badge, date submitted. Filter tabs: `pending`,
  `distributed`, `offered`, `booked`, `cancelled`.
  `requireAdminSession()` gate.
- `/admin/trips/[id]` — detail page with three sections:
  1. **Trip request** — read-only display of all fields. If
     `preferences->'lead_trip_type'` is present, render it next to
     the always-`charter` `trip_type` so admins know the original
     ask.
  2. **Dispatch** — current dispatch state + the
     "Send to operator" action (see §4).
  3. **Offers** — list of `phase4_operator_offers` rows; each card
     shows operator name + phone, total price (SAR), aircraft
     snapshot, departure ETA, **absolute** expiry timestamp
     (Codex iteration 1, decision #5 — no client-side ticking
     countdown), notes, status badge. Each `pending` offer has a
     **"قبول العرض"** button (see §6).

### 4. Send-to-operator dispatch (admin action + token)

Server Action `dispatchTripRequest(tripRequestId, operatorPhone)`:

- `requireAdminSession()`.
- Inputs: `tripRequestId` (UUID), `operatorPhone` (E.164 string,
  validated by Zod against `^\+[1-9]\d{6,14}$`).
- Generates a signed token using the same HMAC primitive the admin
  cookie uses, with **base64url encoding** of the payload and
  signature so the resulting URL segment never contains `/`, `+`,
  or `=` (Codex iteration 1, fix #7). The on-disk shape is:
  `b64url(payload) + '.' + b64url(hmac_sha256(secret, b64url(payload)))`.
- Token payload:
  ```ts
  {
    v: 1,                          // schema version, for forward-compat
    trip_request_id: string,       // UUID
    issued_at: number,             // unix seconds
    expires_at: number,            // issued_at + 72*3600
    nonce: string                  // 16 bytes hex, single-use marker
  }
  ```
- Token is signed with a new env var `OPERATOR_TOKEN_SECRET`
  (32-byte hex). Added to `.env.example` with a comment that it
  must NOT reuse `ADMIN_AUTH_SECRET`.
- Updates `trip_requests`:
  - `status = 'distributed'` (only if currently `'pending'` or
    `'distributed'`; aborts on `'booked'`/`'cancelled'`).
  - `dispatch_nonce = <new nonce>` (overwrites any previous nonce
    so the previous URL stops working).
  - `dispatch_expires_at = NOW() + INTERVAL '72 hours'` (TTL
    confirmed by Codex iteration 1, decision #1).
  - `dispatch_target_phone = operatorPhone`.
  - `dispatched_at = NOW()`.
  - `distributed_at = NOW()` (existing column, kept for parity).
- Builds the operator URL:
  `${NEXT_PUBLIC_SITE_URL}/operator/offer/<token>`.
- Builds a WhatsApp share link:
  `https://wa.me/<digits-only operatorPhone>?text=<urlencoded message>`
  with an Arabic message containing: greeting, request summary
  (route + date + passengers), the operator URL, and the founder's
  phone.
- Returns both URLs to the caller; the admin UI shows a "Copy
  WhatsApp link" button. **No outbound message is sent
  automatically** in Phase 4.

UI for §4 lives in `/admin/trips/[id]` → "Dispatch" section:

- One input: operator's WhatsApp number (E.164).
- One button: **"إرسال للمشغّل"** (Dispatch to operator).
- After dispatch: shows the WhatsApp link + the operator URL +
  the absolute expiry timestamp + a "Re-dispatch" button. Re-dispatch
  generates a new nonce and overwrites the previous link (Codex
  iteration 1, decision #2 — invalidate-on-redispatch).

### 5. Operator offer page (public, token-validated)

Add `/operator/offer/[token]` (NOTE: this is at the App Router
**root**, not under `(public)`, so it gets its own minimal layout
without the public site shell — the operator should not see the
public marketing surface).

- **No `requireAdminSession()`. No Supabase Auth. Anon + service
  role only.** Authentication is *the validity of the signed
  token*.
- Server-side validation on every GET and POST:
  1. Decode the token (split on `.`, base64url-decode payload,
     HMAC verify signature, fail-closed on any decoding error).
  2. Verify `expires_at > now()`.
  3. Load the `trip_requests` row by `trip_request_id`.
  4. Verify `trip_requests.dispatch_nonce` equals the token's
     `nonce` AND `trip_requests.dispatch_expires_at > now()`. This
     is what makes re-dispatch invalidate older links.
  5. Verify `trip_requests.status NOT IN ('booked', 'cancelled')`.
  6. If any check fails, render a friendly Arabic page that says
     **"هذا الرابط منتهي الصلاحية"** with no further details (no
     reflection of the trip request).
- On valid token, render:
  - A read-only summary of the trip request (route, dates,
    passengers, cabin class preference, special requirements). The
    `customer_name` and `customer_phone` are **not** shown to the
    operator on the public page (Phase 4 keeps client identity
    private until acceptance).
  - A form for the offer:
    - Operator name (required, free text, max 120 chars).
    - Operator phone (required, E.164).
    - Operator email (optional).
    - Aircraft category (enum picker → `aircraft_category`).
    - Aircraft type (free text, e.g., "Gulfstream G650").
    - Aircraft registration (free text).
    - Total price in SAR (numeric, required, min 1000).
    - Departure ETA (date+time, required, must be ≥ trip's
      `departure_date`).
    - Validity hours (integer, default 24, range 1-168).
    - Notes (free text, optional).

Submit Server Action `submitOperatorOffer(token, formData)`:

- Re-validates the token (same five checks as the GET handler).
  This is a **necessary but not sufficient** gate — the RPC below
  re-verifies dispatch state inside a `FOR UPDATE` lock to close
  the race window described in §1e-3.
- Validates the form with Zod.
- Invokes the `submit_phase4_operator_offer(...)` RPC defined in
  §1e-3, passing the token's `trip_request_id` and `nonce` plus
  every form field. The RPC returns one of:
  - `{ ok: true, offer_id }` — both insert and trip-status update
    succeeded atomically.
  - `{ ok: false, error: 'trip_not_found' }` — the trip was hard-
    deleted between token issuance and submit (extremely unlikely;
    no admin UI exposes hard-delete in Phase 4).
  - `{ ok: false, error: 'trip_closed' }` — the trip moved to
    `'booked'` or `'cancelled'` after the token was issued.
  - `{ ok: false, error: 'token_stale' }` — the founder
    re-dispatched the trip after this token was issued, overwriting
    `dispatch_nonce` / `dispatch_expires_at` (Codex iteration 3,
    fix #1).
- On `ok: false`, render the same friendly Arabic
  **"هذا الرابط منتهي الصلاحية"** page used for the GET-time
  failures. Do not echo the specific error code to the operator —
  failure modes are intentionally opaque from the public surface.
- On `ok: true`, render an Arabic-RTL success page:
  **"تم استلام عرضك. سيتواصل معك المؤسس عبر واتساب خلال X ساعة."**
  Includes the founder's WhatsApp link.
- **Direct sequential `await supabase.from(...)` calls are NOT
  acceptable for this action.** The RPC is the contract; the
  insert and the `trip_requests.status` update must occur in the
  same transaction.

### 6. Accept offer (admin action)

Server Action `acceptOffer(offerId)`:

- `requireAdminSession()`.
- Calls the SQL function defined in §1e-2:
  `supabase.rpc('accept_phase4_offer', { p_offer_id: offerId })`.
- The function returns one of:
  - `{ ok: true, trip_request_id }` — success.
  - `{ ok: false, error: 'offer_expired' }` — offer's
    `expires_at` is now in the past; the function flipped the
    offer to `'expired'` in the same transaction so the UI
    no longer sees it as pending (Codex iteration 2, fix #2).
  - `{ ok: false, error: 'offer_not_pending' }` — the offer was
    already accepted, rejected, or expired by another path.
  - `{ ok: false, error: 'trip_not_open' }` — the parent trip is
    already booked or cancelled.
- The Server Action surfaces each failure with a distinct
  Arabic-RTL inline error message on the trip detail page. On
  success it revalidates and re-renders.

UI: each pending offer card on `/admin/trips/[id]` has the
**"قبول العرض"** button. After acceptance:

- Accepted offer card gets a green "مقبول" badge.
- Sibling rejected cards get a muted "مرفوض" badge.
- The trip request status badge switches to "محجوز".
- A read-only success notice tells the founder:
  - The accepted operator's phone (clickable
    `wa.me/<digits>?text=<approval template>`).
  - The customer's phone (clickable `wa.me/<digits>?text=<approval template>`).
  - Reminder text: "تواصل يدويًا مع الطرفين لتأكيد التفاصيل
    النهائية" (no automated outbound — Phase 4 stays manual on the
    messaging side).

### 7. Branch + PR strategy

This is the first phase that lands on the protected `main` branch.

- Branch: `feature/phase-4-operator-portal`.
- Run `scripts/preflight.ps1` before each commit.
- Push the feature branch:
  `git push -u origin feature/phase-4-operator-portal`.
- Open a PR to `main`. CI runs automatically.
- Protection rule is `strict: true`, so before merge the PR must
  be **rebased onto the latest `main`**
  (`git fetch origin && git rebase origin/main`).
- Merge only after a green CI run on the PR.
- **Do not** allow this PR to substitute for the deferred
  Phase 3.5.1 Verification PR. Per Codex iteration 1, decision #8,
  the founder runs a standalone fail-on-purpose Verification PR
  *before* this Phase 4 PR opens, so the empirical proof of CI
  gating is decoupled from feature work and the Activation record
  is signed off independently.

## Out of Scope (explicit)

Do not implement any of the following in Phase 4:

- Real operator authentication (Supabase Auth for operators).
- Operator self-service dashboard / operator account creation.
- Multi-operator parallel dispatch (Codex iteration 1, decision
  #3 → Phase 5).
- Inserting any rows into the structured `operators`, `aircraft`,
  or `crew_members` tables.
- Inserting any rows into the structured `offers` table. Phase 4
  uses `phase4_operator_offers` exclusively.
- Operator scoring, response-time tracking, leaderboards.
- Outbound automated WhatsApp / SMS / email to operators or
  clients. Founder copies the WhatsApp link manually. The only
  automated email is the existing Phase 2 admin notification on
  new lead arrival.
- Empty Legs marketplace, AI matching, Aeris Privilege loyalty,
  Aeris MedEvac, Aeris Cargo verticals.
- Payment integration. Acceptance does not trigger any payment
  flow; it only flips status.
- ZATCA invoice generation.
- Mobile app.
- Sentry / PostHog wiring.
- Audit logs (`audit_logs` table integration).
- An English variant of the operator page (Codex iteration 1,
  decision #7 → Phase 4.1).
- A multi-city leg editor (referenced in §2 promotion); shipped as
  Phase 4.1 if needed.
- Replacing the Phase 3.5.1 Activation record fill-in process or
  doubling this PR as the Verification PR (Codex iteration 1,
  decision #8).
- Any change to the CI workflow YAML, ESLint config, audit triage,
  or production-readiness checklist that is not directly required
  by §1's migration.

## Files To Add / Edit

The exact list will be finalized during implementation, but the
expected shape is:

### Add

- `aeris/supabase/migrations/20260504000003_phase_4_operator_portal.sql`
  — the §1 migration in full (1a + 1b + 1c + 1e-1 + 1e-2 + 1e-3).
  Single file, reviewable as one unit.
- `aeris/lib/operator/token.ts` — HMAC sign/verify with base64url
  encoding, mirroring `aeris/lib/admin/auth.ts`'s shape; uses
  `OPERATOR_TOKEN_SECRET`.
- `aeris/lib/validators/promote-lead.ts` — Zod schema for the
  promote-from-lead form.
- `aeris/lib/validators/operator-offer.ts` — Zod schema for the
  operator offer submission.
- `aeris/lib/validators/dispatch.ts` — Zod schema for the dispatch
  form (E.164 phone).
- `aeris/lib/supabase/queries/trips.ts` — typed read helpers for
  `/admin/trips` list/detail, including the `customer_name`
  / `customer_phone` snapshot columns.
- `aeris/lib/supabase/queries/phase4-offers.ts` — typed read
  helpers for the offers card list.
- `aeris/app/(admin)/admin/(protected)/trips/page.tsx` — list.
- `aeris/app/(admin)/admin/(protected)/trips/[id]/page.tsx` —
  detail with dispatch + offers sections.
- `aeris/app/(admin)/admin/actions/trips.ts` — Server Actions:
  `promoteLeadToTripRequest`, `dispatchTripRequest`, `acceptOffer`.
- `aeris/app/operator/offer/[token]/page.tsx` — public operator
  page (root-level App Router segment, with its own minimal
  layout).
- `aeris/app/operator/offer/[token]/layout.tsx` — minimal
  Arabic-RTL layout, no public marketing chrome.
- `aeris/app/operator/offer/[token]/actions.ts` —
  `submitOperatorOffer` Server Action.
- `aeris/components/admin/trip-table.tsx`,
  `trip-detail-card.tsx`,
  `trip-status-badge.tsx`,
  `trip-status-filter.tsx`,
  `dispatch-form.tsx`,
  `dispatch-state-card.tsx`,
  `phase4-offer-card.tsx`,
  `accept-offer-button.tsx`,
  `promote-lead-form.tsx`.
- `aeris/components/operator/trip-summary.tsx` — read-only summary.
- `aeris/components/operator/offer-form.tsx` — Arabic-RTL form.
- `aeris/components/operator/expired-link.tsx` — friendly error
  page.
- `aeris/docs/checklists/operator-flow-smoke-test.md` — manual
  smoke test for promote → dispatch → submit → accept.

### Edit

- `aeris/.env.example` — add `OPERATOR_TOKEN_SECRET` placeholder
  with a comment that it must be a freshly generated 32-byte hex
  (`openssl rand -hex 32`) and must NOT reuse `ADMIN_AUTH_SECRET`.
- `aeris/types/database.ts` — **hand-maintained** per the project
  convention. Phase 4 must add the new columns on `trip_requests`,
  the new column on `lead_inquiries`, and the entire
  `phase4_operator_offers` row + insert + update types. (Codex
  iteration 1, fix #5.) Failure to update this file will surface
  as type errors in Server Actions; treat type-check exit `0` as
  the canonical signal that the file is consistent.
- `aeris/app/(admin)/admin/(protected)/leads/[id]/page.tsx` —
  add the "Promote to trip request" section.
- `aeris/app/(admin)/admin/(protected)/layout.tsx` — add a
  "طلبات الرحلات" link in the admin nav alongside the existing
  leads link.
- `aeris/docs/checklists/env-vars-vercel-supabase.md` — add a row
  for `OPERATOR_TOKEN_SECRET` (server-only).
- `aeris/docs/checklists/security-hardening.md` — extend the
  secret-strength subsection to cover `OPERATOR_TOKEN_SECRET`.
- `aeris/docs/checklists/admin-inbox-smoke-test.md` — append a
  "Promote to trip request" subsection covering the new button +
  redirect behavior.
- `aeris/docs/checklists/README.md` — index entry for
  `operator-flow-smoke-test.md`.
- `aeris/docs/checklists/production-readiness.md` — add the new
  smoke test as a sub-checklist (between
  `admin-inbox-smoke-test.md` and `resend-email-test.md`).
- `aeris/README.md` — link the new smoke test in the production
  checklists section.

### Not edited

- `.github/workflows/ci.yml` — frozen.
- `aeris/scripts/preflight.ps1` — frozen.
- `aeris/docs/security/npm-audit-triage.md` — frozen unless
  Phase 4 introduces a new dependency (it should not).
- `aeris/docs/checklists/ci-pipeline.md` — frozen (Phase 3.5.1
  artifact).
- `aeris/docs/CODEX-REVIEW.md` — Codex's file.
- `aeris/lib/admin/auth.ts` — reuse only; no behavioural change.
- The structured `operators`, `aircraft`, `crew_members`,
  `offers`, `bookings` tables in
  `20260422000001_initial_schema.sql` — not touched.
- The existing `trip_requests_*` and `offers_*` RLS policies —
  not modified.

## Acceptance Criteria

Phase 4 is acceptable only if every item below is true.

### Schema migration

1. `20260504000003_phase_4_operator_portal.sql` exists and applies
   cleanly on a fresh DB after the previous two migrations.
2. After the migration:
   - `trip_requests.client_id` is nullable.
   - `trip_requests.customer_name`, `customer_phone`,
     `customer_source`, `dispatch_nonce`, `dispatch_expires_at`,
     `dispatch_target_phone`, `dispatched_at` exist with the
     types specified in §1a.
   - The `(client_id IS NOT NULL OR (customer_name IS NOT NULL AND customer_phone IS NOT NULL))`
     check constraint is enforced.
   - `lead_inquiries.converted_at` exists.
   - `phase4_operator_offers` exists with all columns + indexes
     + trigger + RLS-on + zero policies.
   - **All three** SQL functions exist, are owned by `postgres`,
     executable only by `service_role`, are `SECURITY DEFINER`,
     and pin `SET search_path = public, pg_temp` (Codex
     iteration 2, fix #3). Verify via `pg_proc.proconfig`
     containing `search_path=public, pg_temp` for each:
     - `promote_lead_to_trip_request(UUID, JSONB, aircraft_category, TEXT, TEXT)`
     - `submit_phase4_operator_offer(UUID, TEXT, TEXT, TEXT, TEXT, aircraft_category, TEXT, TEXT, DECIMAL, TIMESTAMPTZ, INTEGER, TEXT)`
     - `accept_phase4_offer(UUID)`
3. The Phase 3 `supabase-migration-verification.md` checklist is
   re-run; the work log records its pass.

### Functional

4. From `/admin/leads/[id]`, an admin can promote a lead to a trip
   request via the `promote_lead_to_trip_request(...)` RPC,
   ending up on `/admin/trips/[id]` with the new row showing
   customer snapshot, `trip_type = 'charter'`,
   `preferences.lead_trip_type` set, and `status = 'pending'`. The
   source lead row is now `status = 'converted'` with
   `converted_at` set. **No partial-application failure mode
   exists**: simulate by raising an exception inside the function
   between the INSERT and the lead UPDATE (in a one-off test that
   wraps the function in a transaction and rolls back); confirm
   neither row changes (Codex iteration 2, fix #1). The
   re-promotion attempt on a `'converted'` lead returns
   `error = 'lead_not_promotable'` and writes nothing.
5. From `/admin/trips/[id]`, an admin can dispatch to one operator
   and see the WhatsApp share link + the operator URL + the
   absolute expiry timestamp. The trip status is now
   `'distributed'`.
6. Opening the operator URL in a fresh browser session (no admin
   cookie) shows the trip summary and the offer form. The
   operator does **not** see the customer's name or phone.
7. Submitting the offer form via the
   `submit_phase4_operator_offer(...)` RPC succeeds; the operator
   sees the Arabic success page; a `phase4_operator_offers` row
   exists; the trip status is now `'offered'`. **Atomicity
   verification (Codex iteration 3, fix #1):** simulate an
   exception inside the function between the INSERT and the trip
   UPDATE in a one-off test that wraps the call in a transaction
   and rolls back; confirm neither the offer row nor the trip
   status changed.
7a. **Re-dispatch race guard (Codex iteration 3, fix #1).** Issue
    token A for trip T; before submitting, re-dispatch T to
    generate token B (which overwrites T's `dispatch_nonce`).
    Submit the offer form using token A. The RPC returns
    `{ ok: false, error: 'token_stale' }`; **no row is inserted
    into `phase4_operator_offers`** (verify with
    `SELECT count(*) FROM phase4_operator_offers WHERE trip_request_id = T`
    showing the same count as before the failed submit); the
    operator sees the generic "هذا الرابط منتهي الصلاحية" page;
    `trip_requests.status` for T is unchanged.
8. Re-dispatching the same trip generates a new URL; opening the
   previous URL renders the friendly expired page and writes
   nothing to the DB.
9. A token whose payload `expires_at` is in the past renders the
   expired page (verify by issuing a token with a past timestamp
   in a one-off test, or by manually `UPDATE`ing
   `dispatch_expires_at` to a past timestamp; do not actually wait
   72 hours).
10. Accepting an offer results in: that offer
    `status = 'accepted'`, sibling pending offers
    `status = 'rejected'`, trip request `status = 'booked'`. All
    three changes are visible on a single page reload. A second
    admin clicking "Accept" on a different sibling at the same
    moment receives `error = 'offer_not_pending'` and the DB state
    is unchanged.
10a. **Expired-offer guard (Codex iteration 2, fix #2).** Manually
     `UPDATE phase4_operator_offers SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = <pending_offer>;`
     and click "Accept" on it. The Server Action surfaces an
     Arabic-RTL error mapped from `error = 'offer_expired'`; the
     same offer's `status` is now `'expired'` (the function
     auto-flipped it) and `decided_at` is set; the parent trip's
     `status` is unchanged.

### Security

11. `OPERATOR_TOKEN_SECRET` is server-only. Grep confirms no
    `NEXT_PUBLIC_OPERATOR_TOKEN_SECRET` reference anywhere.
12. The operator page never calls a Supabase client with the anon
    key for writes. Writes go through the service role from a
    Server Action that has just validated the token.
13. `phase4_operator_offers` has RLS enabled and zero policies
    (audited via the existing security-hardening checklist).
14. A request to the operator URL with a tampered token (any
    single byte flipped), an expired token, a token whose nonce
    no longer matches `trip_requests.dispatch_nonce`, or a token
    for a `'booked'` trip, returns the friendly expired page and
    writes nothing to the DB.
15. The promote, dispatch, and accept Server Actions all begin
    with `requireAdminSession()`. A request without a valid admin
    cookie redirects to `/admin/login`.
16. The base64url-encoded token contains no `/`, `+`, or `=`
    characters (verified by spot-check of three real tokens).

### Quality gates

17. From `aeris/`, all four gates pass:
    - `npm ci` → exit 0.
    - `npm run type-check` → exit 0. (Implies
      `types/database.ts` is up to date; see fix #5.)
    - `npm run build` → exit 0. New routes:
      `/admin/trips` → `ƒ Dynamic`,
      `/admin/trips/[id]` → `ƒ Dynamic`,
      `/operator/offer/[token]` → `ƒ Dynamic`. Existing public
      routes (`/`, `/request`, `/_not-found`) remain `○ Static`.
    - `npm run lint:strict` → exit 0.
18. `npm audit --json` count and severity breakdown match Phase 3.5
    exactly. If a new dependency is genuinely required, the work
    log includes package + version + reason + fresh advisory
    breakdown.

### Branch protection compliance

19. All Phase 4 work landed on `main` via a PR opened from
    `feature/phase-4-operator-portal`.
20. CI was green on that PR before merge.
21. The PR was rebased onto the latest `main` immediately before
    merge (linear history requirement).
22. No `--force` push, no `--no-verify`, no admin override.
23. The Phase 3.5.1 Verification PR was run and signed off in the
    Activation record **before** this Phase 4 PR opened (Codex
    iteration 1, decision #8).

### Documentation

24. `docs/checklists/operator-flow-smoke-test.md` exists and
    follows the standard checklist shape.
25. `docs/checklists/README.md`, `production-readiness.md`, and
    root `README.md` link the new smoke test.
26. `env-vars-vercel-supabase.md` lists `OPERATOR_TOKEN_SECRET`.
27. `security-hardening.md` covers the new secret's strength and
    rotation guidance.
28. The work log records the migration content (or a tail of it),
    the chosen `expires_at` window (72 hours), the
    multi-city-warning behavior in §2, and any other non-obvious
    decisions.
29. `types/database.ts` reflects the migration; type-check exit
    `0` is the canonical proof.

### Scope discipline

30. No operator authentication, no operator dashboard, no
    automated distribution.
31. No outbound automated messaging from Phase 4.
32. No payment, ZATCA, mobile app, Sentry, audit log, or any
    other roadmap item outside the four-step flow above.
33. No CI workflow YAML change.
34. No insertion into `operators`, `aircraft`, `crew_members`,
    or `offers` tables.

## Commands That Must Pass

After implementation, run from `aeris/`:

```bash
npm ci
npm run type-check
npm run build
npm run lint:strict
```

All four must exit `0`. `npm audit --json` may exit non-zero (still
the Phase 3.5 baseline).

For the migration verification, also run the
`supabase-migration-verification.md` checklist against a local DB
and copy its result into the work log.

## Open Questions Before Implementation

None remain open as of iteration 4. The eight Open Questions from
iteration 1 received Codex decisions; the three iteration-1
blocking findings, the three iteration-2 blocking findings, and
the single iteration-3 blocking finding have all been resolved
structurally. The tables below are the audit trail.

### Codex iteration 1 — open-question decisions

| # | Question | Decision |
|:-:|---|---|
| 1 | Token TTL | 72 hours. |
| 2 | Re-dispatch behavior | Invalidate the previous link. |
| 3 | Multi-operator parallel | Phase 5. |
| 4 | Operator name | Free text in Phase 4 (schema supports it via `phase4_operator_offers`). |
| 5 | Validity countdown | Absolute timestamp only; no ticking component. |
| 6 | Concurrency on accept | RPC + row lock (`accept_phase4_offer` SQL function — see §1e-2). |
| 7 | English variant | Phase 4.1. |
| 8 | First PR doubles as Verification PR | No — run a standalone Verification PR first. |

### Codex iteration 1 — blocking findings (resolved in iteration 2)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | `client_id NOT NULL` blocks guest promotion | §1a migration: `client_id` nullable + customer snapshot columns + check constraint. |
| 2 | `offers.operator_id`/`aircraft_id NOT NULL` blocks free-text submission | §1c migration: new `phase4_operator_offers` snapshot table; structured `offers` untouched. |
| 3 | English status labels do not exist in enums | "Schema Reality" section adds explicit mappings; spec uses real enum values throughout. |
| 4 | `lead_trip_type` ≠ `trip_type` | "Schema Reality" trip-type mapping; §2 promotion always sets `trip_type = 'charter'` and stores the original lead type in `preferences`. |
| 5 | `types/database.ts` hand-maintained | Files-edited list calls it out; type-check exit 0 is the proof signal. |
| 6 | `acceptOffer` should be RPC for transaction safety | §1e-2 SQL function; §6 invokes via `supabase.rpc(...)`. |
| 7 | Token path must be safe-encoded | §4 specifies base64url for both payload and signature; acceptance criterion #16 verifies. |

### Codex iteration 2 — blocking findings (resolved in iteration 3)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | Promotion allowed sequential `await supabase.from(...)` calls — partial-application risk | §1e-1 adds `promote_lead_to_trip_request(...)` SQL function; §2 invokes it via `supabase.rpc(...)`; sequential calls explicitly forbidden. Acceptance criterion #4 requires verifying no partial-application failure mode. |
| 2 | `accept_phase4_offer` could accept an expired offer (`expires_at <= NOW()`) since no background job flips offers to `'expired'` | §1e-2 adds `expires_at > v_now` to the SELECT FOR UPDATE; on miss, distinguishes `offer_expired` from `offer_not_pending` and auto-flips the row to `'expired'` in the same transaction. New acceptance criterion #10a. |
| 3 | `SECURITY DEFINER` functions used unqualified table names without pinning `search_path` — schema-hijacking risk | Both functions in §1e now declare `SET search_path = public, pg_temp` in the function definition. Acceptance criterion #2 verifies via `pg_proc.proconfig`. |

### Codex iteration 3 — blocking finding (resolved in iteration 4)

| # | Finding | Resolution |
|:-:|---|---|
| 1 | `submitOperatorOffer` wrote the offer row and updated `trip_requests.status` as two sequential Supabase calls — partial-state risk if the second call failed, plus a re-dispatch race window between Server-Action token validation and the insert (a token invalidated mid-submit could still attribute an offer) | §1e-3 adds `submit_phase4_operator_offer(...)` SQL function that locks `trip_requests FOR UPDATE`, atomically re-verifies `dispatch_nonce` / `dispatch_expires_at` against the token's `nonce`, inserts the offer, and conditionally promotes the trip status — all in one transaction. Returns `trip_not_found` / `trip_closed` / `token_stale` / `{ok: true, offer_id}`. §5 invokes the RPC and bans sequential calls. Acceptance criterion #2 includes the new function; criterion #7 strengthens the atomicity test; new criterion #7a verifies the re-dispatch race guard with a count assertion. |

## Required Claude Output

Once Codex approves this iteration, Claude will:

- Implement everything above (and only that).
- Run all four quality-gate commands and report results.
- Re-run `supabase-migration-verification.md` against a local DB
  and copy the result into the work log.
- Update `docs/CLAUDE-WORK-LOG.md` with: summary, files added /
  edited, migration tail (or full content if short), exact command
  output, branch + PR URL, CI run URL, the offer-status mapping
  table actually used, the multi-city behavior actually implemented,
  known issues, and questions for the next Codex review.
- Stop. Will not start Phase 5 (operator authentication,
  distribution engine, Empty Legs, etc.) or Phase 3.6 (Sentry
  decision) without a separate task.
