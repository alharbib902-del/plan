# Phase 9 — Charter & Client Portal

> **Status:** Draft for Codex review (round 1).
> **Predecessor:** Phase 8 + Phase 8.x (Operator Portal +
> wasender WhatsApp + cleanup cron) — closed
> 2026-05-12 at sha `14adb7a`. Phase 8 gave operators
> first-class authenticated accounts; Phase 9 does the same
> for clients and closes the trip-request → offer → booking
> loop **without admin mediation**.
>
> **Scope (locked).** Four PRs:
> 1. PR 1 — Client auth (mirror of Phase 8 PR 2c, adapted).
> 2. PR 2 — Authenticated charter form + RPC.
> 3. PR 3 — Client portal (my requests + offer comparison +
>    self-accept).
> 4. PR 4 — Auto-distribution engine + cron + admin canary.
>
> Every PR in this phase MUST clear Codex 100/100 before
> merge.

---

## 0. Objective

Replace the admin-mediated guest trip-request flow with a
real client-account flow:

1. **Clients self-onboard** at `/login` + `/signup` — they
   pick an email, set a bcrypt password, and complete their
   profile (name + phone). The account lands in
   `clients.signup_status='active'` immediately (no admin
   approval required — clients are the demand side, friction
   should be zero).

2. **Authenticated clients submit trip requests** at
   `/me/charter` — origin/destination, dates, passengers,
   aircraft preference, special requests. The Server Action
   writes directly to `trip_requests` with `client_id` set,
   bypassing the lead-inquiry intermediary.

3. **Auto-distribution dispatches** the new request to the
   top-N matching operators automatically (no admin
   intervention). Replaces today's manual `DispatchPanelV2`
   for client-originated trips. Admin retains the panel for
   guest leads + manual override.

4. **Operators see + respond** via the existing
   `/operator/offer/[token]` flow (Phase 4/5 unchanged).
   Operator portal `/operator/(authed)/requests` is added in
   PR 4 as a logged-in inbox alternative.

5. **Clients accept / decline offers** at `/me/requests/[id]`
   — sees all submitted offers side-by-side via
   `UnifiedOfferCard` (the existing admin component, made
   reusable). Accept calls the existing `accept_offer` RPC
   via a NEW Server Action that ownership-checks the trip's
   `client_id = session.client_id` before invoking.

6. **Guest flow stays alive.** `/(public)/request` keeps
   writing to `lead_inquiries` for unauthenticated traffic.
   Admin promotes leads → trip_requests as today. The
   authenticated flow is a parallel, NOT a replacement.

7. **Recovery flows** mirror Phase 8 operator side: email
   reset link with HMAC token (30-min TTL), admin reset (rare
   path; admin already can re-auth a stuck client by inserting
   a fresh password hash via a new RPC).

---

## 1. What this phase does NOT do

Out of scope (deferred to Phase 9.x or later):

- **WhatsApp OTP / WhatsApp delivery for clients.** Phase 8.1
  added wasender for operators; Phase 9 keeps client
  notifications on email only. Adding wasender for clients
  is a follow-up PR after the trial expires + the founder
  subscribes.
- **Phone verification.** Clients submit `phone` but there
  is no SMS/WhatsApp verify step. The phone is captured
  for future booking confirmation use (admin/operator manual
  outreach).
- **Client document uploads.** Operators upload regulatory
  docs in Phase 8; clients have no equivalent (no licensure
  to attach). Passport upload + KYC for high-value bookings
  is Phase 10+.
- **Loyalty / Privilege tier integration.** The
  `loyalty_transactions` table exists from initial schema
  but Phase 9 does not surface tier status, points earned,
  or redemption flows. Privilege phase is separate.
- **Multi-leg / round-trip request UI.** `trip_requests.legs`
  JSONB exists but the new authenticated form ships
  one-way + simple round-trip only. Multi-city itinerary
  builder is Phase 9.x.
- **Real-time offer notifications.** Clients see new offers
  on page refresh / `/me/requests` poll. Realtime via
  Supabase Realtime is Phase 9.x.
- **Client "saved trips" / "favorites" / repeat-booking
  shortcuts.** Trip-request history is read-only in PR 3.

---

## 2. Locked decisions

These are settled before spec acceptance:

1. **Client identity table.** New `clients` table parallel
   to `operators`, NOT a `users.role='client'` extension.
   Mirrors Phase 8 §3.1 rationale: separate auth surface,
   separate session table, separate audit trigger. Avoids
   coupling the customer-facing auth schema to the existing
   admin/operator user model.

2. **Email is the unique identifier.** `clients.auth_email`
   with unique LOWER() index (mirrors Phase 8
   `_normalize_operator_email` discipline). One client per
   email, case-insensitive lookup.

3. **No admin approval gate.** New clients land in
   `signup_status='active'` immediately. The friction model
   from Phase 8 (operator approval) does not apply — clients
   are the buying side, abandon if blocked.

4. **bcrypt cost = 12.** Same as Phase 8; vetted for Vercel
   cold-start latency.

5. **Session TTL: 7 days default, 30 days with "تذكّرني".**
   Same as Phase 8 operators.

6. **Auto-dispatch fan-out: top 5 operators.** Mirrors the
   spec sketch in CLAUDE.md "Trip Distribution Engine".
   Score weights: rating 40 / response time 30 / price 20
   / location 10. PR 4 ships the implementation.

7. **Auto-dispatch trigger.** Fire-and-forget after the
   `create_authenticated_trip_request` RPC commits, mirroring
   the Phase 7 PR 2e match-trigger pattern. Failures fall back
   to the admin queue (`DispatchPanelV2` shows "auto-dispatch
   failed, dispatch manually" affordance).

8. **Existing `accept_offer` RPC stays unchanged.** PR 3 wires
   a new client-callable Server Action that:
   - Pre-SELECTs `trip_requests WHERE id=:trip AND
     client_id=:session.client_id` (defense-in-depth ownership
     check; the RPC itself remains admin-callable as
     today).
   - Calls `accept_offer(source, offer_id)` unchanged.
   - Revalidates `/me/requests` + `/me/requests/[id]` paths.

9. **Client portal route group.** New `(client)` route group
   for protected client pages. URL stays clean: `/me/charter`,
   `/me/requests`, `/me/requests/[id]`, `/me/profile`,
   `/me/profile/password`. The `(client)` group is invisible
   in the URL, mirrors Phase 8 `(authed)` for operators.

10. **Backwards compatibility for guests.** `(public)/request`
    keeps writing to `lead_inquiries`. The promote-to-trip
    admin flow stays. NO migration of existing lead rows to
    trip_requests; admin promotes one-by-one as today.

11. **Auto-dispatch ships OFF by default.** Env flag
    `ENABLE_TRIP_AUTO_DISTRIBUTION` defaults to **`false`**
    (Codex round 1 P1 #3 fix). The flag is flipped to `true`
    explicitly by the founder ONLY AFTER Probes 16 + 17
    confirm the scoring + Phase 5 token issuance + wa.me
    delivery path all work on production. Until then, every
    trip lands `pending` for manual admin dispatch via
    `DispatchPanelV2`. PR 2's create-trip Server Action
    inspects the flag and skips the fire-and-forget POST when
    false; PR 4's auto-dispatch RPC is callable directly
    (admin force-dispatch button) regardless of the flag for
    smoke testing.

12. **Auto-dispatch retention window.** Auto-dispatched trips
    that no operator responds to within 4 hours fall back to
    the admin queue + send a founder batch alert (mirrors
    Phase 7 §16 outreach alert pattern).

---

## 3. Schema (PR 1 + PR 4 migrations)

### §3.1 — `clients` table (PR 1)

Mirrors Phase 8 `operators` extension shape but standalone
(no inheritance from `users`).

**Migration order (Codex round 6 P1 #1 fix).** The
`client_status` enum MUST be created BEFORE `CREATE TABLE
clients` because `clients.signup_status` references the
type at table-creation time. The earlier round-5 ordering
placed the enum DO block AFTER the CREATE TABLE, which
would fail with `type "client_status" does not exist` on
a fresh DB. The migration ships the enum block first, then
the table:

```sql
-- §3.1.a — client_status enum (must run BEFORE CREATE
-- TABLE clients). Replay-safe via DO block + pg_type
-- existence check, schema-scoped to public to avoid
-- false positives from same-name types in other schemas
-- (Codex round 6 P1 #1 hardening).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'client_status'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.client_status AS ENUM (
      'active',     -- normal state
      'suspended',  -- admin-suspended (rare; future moderation)
      'deleted'     -- soft-delete; sessions revoked, login blocked
    );
  END IF;
END $$;

-- §3.1.b — clients table (depends on client_status above).
CREATE TABLE IF NOT EXISTS clients (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Identity (auth_email is the unique login key)
  auth_email               VARCHAR(120) NOT NULL,
  full_name                VARCHAR(120) NOT NULL,
  contact_phone            VARCHAR(20)  NOT NULL,
  -- Auth secrets
  password_hash            TEXT NOT NULL,           -- bcrypt cost=12
  password_must_change     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Lifecycle
  signup_status            client_status NOT NULL DEFAULT 'active',
  last_login_at            TIMESTAMPTZ,
  -- Notifications opt-in (capture once at signup; expand later)
  marketing_opt_in         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Timestamps
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique on lowercase email (case-insensitive lookup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_auth_email_lower
  ON clients (LOWER(auth_email));

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- No RLS policies: service_role bypasses; runtime code
-- always uses the service-role admin client. Client-side
-- direct DB access is not available.
```

### §3.2 — `client_sessions` table (PR 1)

```sql
CREATE TABLE IF NOT EXISTS client_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash      VARCHAR(64) NOT NULL,    -- sha256(raw_token)
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  remember_me     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address      INET,
  user_agent      TEXT,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_sessions_token_hash
  ON client_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_client_sessions_client_id
  ON client_sessions (client_id);

ALTER TABLE client_sessions ENABLE ROW LEVEL SECURITY;
```

### §3.3 — `client_password_reset_tokens` table (PR 1)

Identical shape to `operator_password_reset_tokens` from
Phase 8 §3.6.

```sql
CREATE TABLE IF NOT EXISTS client_password_reset_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash      VARCHAR(64) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_reset_tokens_hash
  ON client_password_reset_tokens (token_hash);

ALTER TABLE client_password_reset_tokens ENABLE ROW LEVEL SECURITY;
```

### §3.4 — `client_signup_attempts` table (PR 1)

Anti-spam log, mirrors Phase 8 §3.9.

```sql
CREATE TABLE IF NOT EXISTS client_signup_attempts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address      INET NOT NULL,
  attempted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_attempted TEXT,
  result          TEXT NOT NULL CHECK (result IN ('success','duplicate_email','rate_limited','validation_failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_signup_attempts_ip_recent
  ON client_signup_attempts (ip_address, attempted_at DESC);

ALTER TABLE client_signup_attempts ENABLE ROW LEVEL SECURITY;
```

### §3.5 — Extend `trip_requests` (PR 1)

`trip_requests.client_id` is already nullable per Phase 4
PR #6. PR 1 confirms the column exists + adds a defensive
index for the new client-portal queries:

```sql
CREATE INDEX IF NOT EXISTS idx_trip_requests_client_status
  ON trip_requests (client_id, status, created_at DESC)
  WHERE client_id IS NOT NULL;
```

This index supports `/me/requests` listing (filter by client,
order by recent) without a sequential scan once client traffic
grows.

### §3.6 — Audit trigger on `clients` (PR 1)

Mirrors Phase 8 §3.11 for operators.

```sql
CREATE OR REPLACE FUNCTION clients_audit_trigger()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.signup_status IS DISTINCT FROM NEW.signup_status THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('client', NEW.id, 'signup_status_changed',
              jsonb_build_object('signup_status', OLD.signup_status),
              jsonb_build_object('signup_status', NEW.signup_status));
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('client', NEW.id, 'password_changed', NULL, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_audit ON clients;
CREATE TRIGGER clients_audit AFTER UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION clients_audit_trigger();
```

### §3.7 — `client_notification_alert_status` singleton (PR 1)

Mirrors Phase 8 §3.10 + Phase 8.1 WhatsApp extension. Email
only at this phase (no whatsapp_status column — clients are
email-only per §1).

```sql
CREATE TABLE IF NOT EXISTS client_notification_alert_status (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status               TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at      TIMESTAMPTZ,
  last_failure_reason  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO client_notification_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE client_notification_alert_status ENABLE ROW LEVEL SECURITY;
```

### §3.8 — `trip_distribution_log` (PR 4)

Observability table for the auto-distribution engine.
One row per (trip × round × operator) triple — the
uniqueness key is **target-scoped** (Codex round 3 P1 #2
fix). The earlier `UNIQUE (trip_request_id, operator_id)`
proposal blocked the legitimate redispatch + admin-force-
dispatch flows: a stale/timeout redispatch may legitimately
choose the same top-ranked operator in a fresh round, and
`adminForceAutoDispatch` re-fires the dispatcher; both
would have hit the cross-round uniqueness violation.

```sql
CREATE TABLE IF NOT EXISTS trip_distribution_log (
  id                  BIGSERIAL PRIMARY KEY,
  trip_request_id     UUID NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
  operator_id         UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  dispatched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score               DECIMAL(5,2) NOT NULL,        -- 0.00 .. 100.00
  rank                INT NOT NULL,                  -- 1..5 (top-N)
  dispatch_target_id  UUID NOT NULL REFERENCES trip_dispatch_targets(id) ON DELETE CASCADE,
  notification_channel TEXT NOT NULL DEFAULT 'whatsapp_link'
    CHECK (notification_channel IN ('whatsapp_link', 'email', 'sms')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Round-scoped uniqueness: dispatch_target_id is unique
  -- per (round, operator) by Phase 5's targets table design,
  -- so this naturally prevents double-logging within a round
  -- while allowing the same operator to appear in subsequent
  -- rounds for the same trip (legitimate redispatch).
  UNIQUE (dispatch_target_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_distribution_log_trip
  ON trip_distribution_log (trip_request_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_distribution_log_op
  ON trip_distribution_log (operator_id, dispatched_at DESC);

ALTER TABLE trip_distribution_log ENABLE ROW LEVEL SECURITY;
```

Notes on the changed FK semantics:
- `dispatch_target_id` is now `NOT NULL` (was nullable).
  Every log row corresponds to a specific dispatch target.
- The FK `ON DELETE` action changed from `SET NULL` to
  `CASCADE`: if a target row is hard-deleted (rare; only via
  data-cleanup scripts), the log row goes with it. Soft
  closure via `status='cancelled'` keeps the FK intact.

### §3.9 — Cleanup cron RPCs registered in
`operator_cron_tick_history` (PR 1 + PR 4)

The CHECK extension is split across PR ownership boundaries
(Codex round 2 P2 #2 fix) so each PR's migration only touches
the constraint when its corresponding cron route + RPC are
also landing.

**PR 1 migration adds 3 client-cleanup job names** (the cron
routes + RPCs ship in the same migration):

```sql
ALTER TABLE operator_cron_tick_history
  DROP CONSTRAINT IF EXISTS operator_cron_tick_history_job_name_check;

ALTER TABLE operator_cron_tick_history
  ADD CONSTRAINT operator_cron_tick_history_job_name_check
  CHECK (job_name IN (
    -- Phase 8 PR 2e jobs (existing on production)
    'cleanup_expired_operator_sessions',
    'cleanup_expired_password_reset_tokens',
    'cleanup_expired_otp_codes',
    'cleanup_old_signup_attempts',
    -- Phase 9 PR 1 jobs (NEW)
    'cleanup_expired_client_sessions',
    'cleanup_expired_client_password_reset_tokens',
    'cleanup_old_client_signup_attempts'
  ));
```

**PR 4 migration extends the CHECK with the 1 redispatch
job name** (its cron route + RPC ship in the same migration):

```sql
ALTER TABLE operator_cron_tick_history
  DROP CONSTRAINT IF EXISTS operator_cron_tick_history_job_name_check;

ALTER TABLE operator_cron_tick_history
  ADD CONSTRAINT operator_cron_tick_history_job_name_check
  CHECK (job_name IN (
    -- Phase 8 PR 2e jobs (existing on production)
    'cleanup_expired_operator_sessions',
    'cleanup_expired_password_reset_tokens',
    'cleanup_expired_otp_codes',
    'cleanup_old_signup_attempts',
    -- Phase 9 PR 1 jobs (added by PR 1)
    'cleanup_expired_client_sessions',
    'cleanup_expired_client_password_reset_tokens',
    'cleanup_old_client_signup_attempts',
    -- Phase 9 PR 4 job (NEW)
    'redispatch_stale_trip_requests'
  ));
```

Total: **4 new Phase 9 job names** (3 in PR 1 + 1 in PR 4).
Each PR's migration restates the FULL constraint to keep
each migration file self-contained for replay/DR scenarios.

Important: rename the table to a generic name? **No** — it
keeps `operator_` prefix for historical accuracy. Re-purpose
existing infrastructure rather than fork tracking.

---

## 4. RPC layer (PR 1 + PR 2 + PR 4)

All `SECURITY DEFINER`, `SET search_path = public, pg_temp`,
`REVOKE ALL FROM PUBLIC + REVOKE FROM anon, authenticated +
GRANT EXECUTE TO service_role` per Phase 8 PR 2a hotfix
discipline. **No parameterless RPCs are added to
`database.ts` Functions map** (the Phase 8 PR 2e #48 incident
made that pattern brittle).

### §4.1 — Auth RPCs (PR 1) — 7 publics + 1 helper

Mirrors Phase 8 PR 2a operator suite.

| RPC | Purpose |
|---|---|
| `_normalize_client_email(p_email TEXT) → TEXT` | helper: trim+lower, advisory-locked LOWER() lookup support |
| `client_signup(p_email, p_password_hash, p_full_name, p_phone, p_marketing_opt_in, p_ip)` | INSERT into clients + writes signup_attempts row; rate-limited 3/IP/24h |
| `client_login_lookup(p_email)` | NULL-safe email→client_id+password_hash lookup (RPC pre-bcrypt-compare) |
| `client_login_create_session(p_client_id, p_session_token_hash, p_remember_me, p_ip, p_user_agent)` | INSERT client_sessions row, returns expiry |
| `client_logout(p_session_token_hash)` | UPDATE revoked_at on the matching session |
| `client_session_validate(p_session_token_hash)` | SELECT join: returns `{client_id, full_name, contact_phone, password_must_change, signup_status}`; rejects revoked / expired |
| `client_mint_password_reset_token(p_email, p_token_hash, p_expires_at, p_ip)` | INSERT row; returns `{ok:true, no_op:true}` for unknown emails (enumeration-safe) |
| `client_verify_password_reset(p_token_hash, p_new_password_hash)` | atomic verify + update + mark used; revokes all sessions |

**Token-hash shape validation contract (Codex round 2 P2 #1
fix).** Every PR 1 RPC that accepts a `p_session_token_hash`
or `p_token_hash` parameter MUST validate the input shape via
the existing Phase 8 PR 2a `_is_sha256_hex(TEXT)` helper
**before** any read or write. The helper is already on
production (Phase 8 PR 2a hotfix migration revoked it from
`anon, authenticated, service_role`; only function-owner
roles inside SECURITY DEFINER bodies can call it — exactly
the access pattern PR 1 client RPCs need).

Affected RPCs:
- `client_login_create_session` — validate `p_session_token_hash`
- `client_logout` — validate `p_session_token_hash`
- `client_session_validate` — validate `p_session_token_hash`
- `client_mint_password_reset_token` — validate `p_token_hash`
- `client_verify_password_reset` — validate `p_token_hash`

Failure mode: a non-sha256-hex value (NULL, < 64 chars,
non-hex chars) MUST return `{ok: false, error:
'invalid_token_hash'}` instead of falling through to a raw
PostgreSQL CHECK violation. This closes the same DB-boundary
weakness Phase 8 PR 2a fixed for operator RPCs (see Phase 8
closure entry §"Lessons learned" #3 in `CLAUDE-WORK-LOG.md`).

PR 1 does NOT redefine `_is_sha256_hex` — the migration
header explicitly cites the existing function as a dependency.
Probe 2 grant assertion is amended to verify
`_is_sha256_hex` ACL is unchanged after PR 1 deploys (no
accidental GRANT relaxation). A new sub-probe — Probe 3-shape
— curls `client_session_validate` with a 65-char hex string
and asserts the structured `invalid_token_hash` error
surfaces.

### §4.2 — Trip RPC (PR 2) — 1 public

| RPC | Purpose |
|---|---|
| `create_authenticated_trip_request(p_client_id, p_trip_type, p_legs, p_departure_iata, p_arrival_iata, p_departure_date, p_return_date, p_passengers, p_aircraft_pref, p_special_requests)` | INSERT into trip_requests with `client_id` set + customer snapshot from clients row + status='pending'; returns `{ok, trip_request_id, request_number}` |

The function **does NOT** dispatch — dispatch is a separate
fire-and-forget call from the Server Action layer (mirrors
Phase 7 PR 2e match-trigger pattern). This keeps the RPC
testable in isolation + lets PR 4 swap the dispatch
mechanism without changing the create RPC.

### §4.3 — Auto-distribution RPC (PR 4) — 2 publics

| RPC | Purpose |
|---|---|
| `score_operators_for_trip(p_trip_request_id) → JSON` | reads trip + operators (filtered by eligibility predicate, see below), returns top-5 `[{operator_id, score, rank, contact_phone, …}]` ordered by score desc; pure read, no writes |
| `auto_dispatch_trip_request(p_trip_request_id) → JSON` | scores → opens Phase 5 dispatch round with per-target token issuance (see contract below) → INSERTs `trip_distribution_log` rows → sets `trip_requests.current_dispatch_round_id`; returns `{ok:true, dispatched_count, round_id, targets:[{operator_id, target_id, wa_me_url}]}` |

**Operator eligibility predicate (Codex round 3 P1 #1
fix).** `score_operators_for_trip` MUST restrict the
candidate pool to operators that are:

```sql
WHERE signup_status = 'approved'
  AND contact_phone IS NOT NULL
  AND TRIM(contact_phone) <> ''
```

Rationale: Phase 8 introduced the `operator_status` ENUM
(`pending` / `approved` / `suspended` / `rejected`).
Without this filter, auto-dispatch could route real
client trips to:
- Pending operators (haven't been admin-approved yet)
- Suspended operators (admin-blocked, possibly for
  safety/compliance reasons)
- Rejected operators (admin explicitly denied entry)
- Operators with NULL/blank `contact_phone` (Phase 5 wa.me
  link generation would emit a malformed URL)

The filter MUST be enforced inside the RPC body itself
(not at the application layer) so any future caller
inherits the safety guarantee. Probes 15 + 16 are amended
to seed an unapproved operator with high default scoring
data and assert it is excluded from both the preview
output AND the dispatched-targets log.

**Phone dedupe contract (Codex round 4 P2 #2 fix).**
Phase 5's `trip_dispatch_targets` table enforces uniqueness
on `(dispatch_round_id, target_phone)` — two operators
sharing the same `contact_phone` value (e.g. multi-account
shell companies, data-entry duplicates, the same charter
broker registered twice) would cause the SECOND target
INSERT to fail with a unique-violation, aborting the entire
dispatch transaction and leaving the trip in a partially-
dispatched state.

`auto_dispatch_trip_request` MUST dedupe the scoring output
by normalised `contact_phone` BEFORE building the
`trip_dispatch_targets` payload. The dedupe rule:

```sql
-- Pseudocode for the dedupe step (between scoring and
-- target INSERT). Inside auto_dispatch_trip_request body,
-- after `score_operators_for_trip` returns top-N:
--
--   1. Normalise each operator's contact_phone (TRIM +
--      strip whitespace; canonical E.164 form is enforced
--      by Phase 8 operator signup, but TRIM defends
--      against drift).
--   2. Group by normalised phone; for each group, keep
--      ONLY the highest-ranked (lowest `rank` value)
--      operator. Drop the rest.
--   3. Re-rank the deduped list 1..N (so `rank` stays
--      contiguous in trip_distribution_log).
--   4. Pass the deduped list to the target INSERT
--      pipeline.
```

If dedupe collapses the list below a minimum-fan-out floor
(`PHASE_9_MIN_DISPATCH_FANOUT=2`, env-configurable, default
2), the RPC returns `{ok:false, error:
'insufficient_unique_operators', dispatched_count:0}` and
**does NOT open a dispatch round** — the trip stays
`pending` for admin review. This is strictly safer than
dispatching to 1 operator (no competition → no offer
pressure).

**No DB audit row for this decline reason (Codex round 6
P2 #1 fix).** The earlier round-4 wording promised an
"audit row" for this decline, but `trip_distribution_log`
requires NOT NULL `operator_id` + NOT NULL
`dispatch_target_id`, which the dedupe-failure case has
neither. Rather than add a parallel failure-events table
(out of scope for the dedupe fix), the dedupe-decline
signal lives in TWO places only:
  1. The RPC's structured return value
     (`{ok:false, error:'insufficient_unique_operators'}`)
     — surfaced to the calling Server Action, which
     can render an admin-visible toast / log line.
  2. A `console.error()` line in the Internal API route
     handler with the trip_request_id + the surviving-
     unique-phone count, captured by Vercel Functions
     logs.
The admin canary readout (Phase 8 PR 2e infrastructure)
shows the dispatched count per trip via
`trip_distribution_log`; a dedupe-decline trip simply has
zero log rows, which is the same observable signal as
auto-dispatch being disabled. Founder triage path:
inspect Vercel Functions logs for the `console.error`
when admin notices a trip stuck `pending` past the
expected dispatch window.

The dedupe rule is documented in `lib/automation/trip-
distribution.ts` JSDoc + asserted by 3+ unit-test cases in
`__tests__/trip-distribution.test.ts`:
  - 5 unique phones → 5 targets dispatched
  - 5 operators, 2 sharing a phone → 4 targets (one
    dropped, the lower-rank duplicate)
  - 5 operators all sharing one phone → 1 unique → RPC
    returns `insufficient_unique_operators`, no round
    opened, no log rows written

Probe 16 is amended to insert two synthetic approved
operators with identical `contact_phone` values, dispatch a
trip, and assert exactly ONE of them appears in
`trip_distribution_log` (the higher-ranked) — confirming
the SQL-level uniqueness violation never occurs in
production.

**Phase 5 token issuance contract for `auto_dispatch_trip_request`
(Codex round 1 P1 #4 fix)**

The existing Phase 5 dispatch path persists each
`trip_dispatch_targets` row with the columns shipped by the
Phase 5 migration — **the table has no `operator_id` column**
(Codex round 2 P1 #1 fix). Operator ownership of a target row
is recovered downstream via the `target_phone` ↔
`operators.contact_phone` join, NOT via FK on the targets
table itself. The columns `auto_dispatch_trip_request` must
populate (whether by calling `open_phase5_dispatch_round` or
inlining the equivalent INSERT):

| Column | Source | Notes |
|---|---|---|
| `id` | `uuid_generate_v4()` | PK |
| `dispatch_round_id` | from the newly opened round | FK |
| `target_phone` | from operators.contact_phone (looked up via the scoring output's `operator_id`) | wa.me destination |
| `nonce` | `encode(gen_random_bytes(16), 'hex')` | 32-char hex, HMAC payload (Codex round 5 P1 #2 fix — `bytea::hex` is not valid PostgreSQL syntax; use `encode(…, 'hex')` for bytea→text conversion). Implementations that mint the nonce in TypeScript before calling the existing Phase 5 opener may instead pass the hex string directly. |
| `sent_at` | `NOW()` | dispatch timestamp |
| `expires_at` | `NOW() + INTERVAL '4 hours'` | matches §1 retention |
| `status` | `'pending'` | dispatch_target_status enum |

The operator → target relation is preserved in
`trip_distribution_log` (which DOES have `operator_id` per
§3.8) plus the `dispatch_target_id` FK back to
`trip_dispatch_targets`. Admin canary joins flow:

```sql
trip_distribution_log
  JOIN trip_dispatch_targets ON dispatch_target_id = id
  JOIN operators            ON trip_distribution_log.operator_id = operators.id
```

The RPC MUST either:
(a) **Reuse** the existing `open_phase5_dispatch_round(trip_id,
    targets[])` RPC by building the `targets[]` argument from
    the scoring output. This is the preferred path — zero new
    token logic, identical wa.me URL shape (`v=2` token over
    `dispatch_target.id + nonce`) as today's admin dispatch.
(b) **Inline** the equivalent INSERT-per-target + token mint
    if (a) is infeasible (e.g. open_phase5 has a different
    argument shape). This path MUST cite which Phase 5 helper
    function generates the v=2 token + emit identical URL
    shape so operator-side `/operator/offer/[token]` accepts
    the wa.me link without code change.

`trip_distribution_log` rows are populated AFTER the
`trip_dispatch_targets` rows are inserted: one log row per
(trip, operator, target) triple, with `operator_id` filled
from the scoring output and `dispatch_target_id` filled from
the newly-INSERTed target row's id.

Probe 17 asserts the wa.me link in each
`trip_distribution_log` row resolves to the operator-side
form without 404; this is the end-to-end check that the
token issuance contract holds.

### §4.4 — Cleanup cron RPCs (PR 1 + PR 4) — 4 publics

Mirror Phase 8 PR 2e:

| RPC | Cleanup |
|---|---|
| `cleanup_expired_client_sessions()` | DELETE WHERE expires_at <= NOW() OR revoked_at IS NOT NULL |
| `cleanup_expired_client_password_reset_tokens()` | DELETE WHERE expires_at <= NOW() OR used_at IS NOT NULL |
| `cleanup_old_client_signup_attempts()` | DELETE WHERE attempted_at < NOW() - INTERVAL '24 hours' |
| `redispatch_stale_trip_requests()` (PR 4) | finds trips dispatched > 4 hours ago with no `phase5_operator_offers`; for each stale trip executes the full state-cleanup transaction below; emits founder batch alert (best-effort, post-commit) |

**`redispatch_stale_trip_requests` state-cleanup contract
(Codex round 3 P2 #2 fix).** Flipping
`trip_requests.current_dispatch_round_id` to NULL alone
leaves the stale Phase 5 round + targets looking "open" in
both `DispatchPanelV2` and admin SQL audits even though the
trip is back in the queue. The RPC MUST execute the
following inside a single transaction per stale trip:

```sql
-- For each stale trip (trip_request_id, current_round_id):
--
-- 1. Cancel any still-pending targets in the stale round
--    (status='submitted' targets stay as-is — operator
--    already responded; status='cancelled'/'expired' are
--    no-ops).
UPDATE trip_dispatch_targets
   SET status = 'cancelled'
 WHERE dispatch_round_id = :current_round_id
   AND status = 'pending';

-- 2. Close the stale round with a dedicated reason.
--    Phase 5's trip_dispatch_rounds.closed_reason is plain
--    text today (no CHECK constraint, no enum). PR 4
--    migration adds an explicit CHECK constraint that
--    pins the allowed values + the new 'stale_timeout'
--    value (Codex round 5 P2 #1 fix — the round 4 wording
--    incorrectly assumed an existing enum/CHECK; that was
--    not in the schema audit). See migration block below
--    this code sample.
UPDATE trip_dispatch_rounds
   SET status = 'closed',
       closed_reason = 'stale_timeout',
       closed_at = NOW()
 WHERE id = :current_round_id
   AND status = 'open';

-- 3. NULL the trip's current_dispatch_round_id so
--    DispatchPanelV2 (and any read query keyed on
--    "open round") re-picks it up.
UPDATE trip_requests
   SET current_dispatch_round_id = NULL
 WHERE id = :trip_request_id;
```

The three UPDATEs run in the order above. If any fails, the
transaction rolls back and the next cron tick retries. The
founder batch alert is best-effort and emitted ONLY after
the transaction commits (mirrors the Phase 7 §16 outreach
alert post-commit pattern). Probe 18 is amended to assert
all three state changes (target = `cancelled`, round =
`closed`/`stale_timeout`, trip's `current_dispatch_round_id`
= NULL) AFTER the cron tick.

**`closed_reason` CHECK constraint (Codex round 5 P2 #1
fix).** The PR 4 migration introduces a real CHECK
constraint on `trip_dispatch_rounds.closed_reason`,
pinning the allowed values explicitly. Phase 5 currently
stores this as unbounded text; the migration audits
existing rows + adds the constraint atomically with the
`redispatch_stale_trip_requests` RPC body so the
`'stale_timeout'` value cannot land in production without
the matching schema enforcement:

```sql
-- PR 4 migration §X (executed before the RPC CREATE):

-- Audit existing rows. If any row has a value outside the
-- expected set, fail loudly so a Phase 5 historical
-- divergence is fixed manually before the constraint
-- lands. (Audit confirmed Phase 5 ships only the three
-- values below, but the assertion documents intent and
-- guards future schema drift.)
DO $$
DECLARE
  v_offending_count INT;
BEGIN
  -- Audit allowlist MUST include 'stale_timeout' so a
  -- replay AFTER redispatch_stale_trip_requests has
  -- written its first row does not RAISE on values the
  -- migration itself enabled (Codex round 6 P1 #2 fix).
  SELECT COUNT(*) INTO v_offending_count
    FROM trip_dispatch_rounds
   WHERE closed_reason IS NOT NULL
     AND closed_reason NOT IN (
       'offer_accepted',
       'redispatched',
       'admin_cancel',
       'stale_timeout'
     );
  IF v_offending_count > 0 THEN
    RAISE EXCEPTION 'PR 4 migration: trip_dispatch_rounds has % rows with unexpected closed_reason values; manual cleanup required before CHECK can be added', v_offending_count;
  END IF;
END $$;

-- Idempotent constraint application: drop the prior
-- definition (if any) before re-adding so a replay does
-- not fail with "constraint already exists" (Codex
-- round 6 P1 #2 fix).
ALTER TABLE trip_dispatch_rounds
  DROP CONSTRAINT IF EXISTS trip_dispatch_rounds_closed_reason_check;

ALTER TABLE trip_dispatch_rounds
  ADD CONSTRAINT trip_dispatch_rounds_closed_reason_check
  CHECK (
    closed_reason IS NULL
    OR closed_reason IN (
      'offer_accepted',
      'redispatched',
      'admin_cancel',
      'stale_timeout'
    )
  );
```

The CHECK ships in the same migration file as the
`redispatch_stale_trip_requests` body, so the RPC's
`closed_reason='stale_timeout'` write is always backed by
schema enforcement on production. Future closed_reason
values (e.g. Phase 10 admin merge/split) will require an
explicit migration to extend the CHECK list (and to
extend the audit allowlist above for the same replay-
safety reason).

---

## 5. PR breakdown

### PR 1 — Client auth (5 new tables, 10 publics + 1 helper,
8 Server Actions, 7 pages, ~12 components, 1 middleware
extension, 3 cleanup-cron entries)

Inventory (Codex round 1 P1 #1 alignment): **10 PR 1 publics
= 7 auth (§4.1) + 3 cleanup (§4.4 — the 4th cleanup
`redispatch_stale_trip_requests` is PR 4 only)**. Plus 1
internal helper (`_normalize_client_email`). Plus 8 Server
Actions (§5 list below). Probe 2 grant-count assertion is
keyed to this allowlist exactly.

**Migrations (1 file):**
- `20260520000026_phase_9_pr_1_client_auth.sql` — sections
  §3.1 through §3.7 + §3.9 + §4.1 + §4.4 cleanup RPC bodies
  + GRANTs + audit trigger.

**Routes:**
- `/(public)/login` — email + password + "تذكّرني" toggle.
- `/(public)/signup` — email + password + full_name + phone
  + opt-in checkbox.
- `/(public)/forgot-password` — enumeration-safe form.
- `/(public)/reset-password/[token]` — set new password.
- `/(client)/me/profile/page.tsx` — view profile (read-only
  email; editable name/phone).
- `/(client)/me/profile/password/page.tsx` — change password.
- `/(client)/me/page.tsx` — landing (placeholder until PR 2
  + 3 land; redirects to `/me/charter` once available).

**Server Actions (`app/actions/clients-public.ts`):**
- `clientSignup`, `clientLogin`, `clientLogout`,
  `clientRequestPasswordReset`, `clientVerifyPasswordReset`,
  `clientChangePassword`, `clientUpdateProfile`,
  `clientWelcomeConsume` (no welcome flow yet — placeholder
  for Phase 9.x admin-mint).

**Lib:**
- `lib/clients/auth.ts` — `requireClientSession()`,
  `setClientSessionCookie()`, `clearClientSessionCookie()`,
  `getRawSessionTokenFromCookie()`, `hashSessionToken()`,
  `mintClientSessionToken()`.
- `lib/clients/password.ts` — `hashClientPassword()`,
  `verifyClientPassword()` (bcryptjs cost=12).
- `lib/clients/password-reset-token.ts` — HMAC-bound 30-min
  TTL (separate secret env: `CLIENT_PASSWORD_RESET_TOKEN_SECRET`).
- `lib/notifications/client-email.ts` — Resend wrappers for
  reset link + welcome (welcome unused in PR 1).
- `lib/notifications/client-email-alert-status.ts` —
  recordClientEmailAlertStatus (mirror of Phase 8.1) PLUS a
  read helper `getClientNotificationAlertStatus()` consumed
  by the canary page extension below.

**Canary page extension (Codex round 1 P2 #1 fix):**

PR 1 extends the existing Phase 8 PR 2e canary page at
`/admin/operators/canary` with a 4th `<ChannelHealth>` card
inside the existing "صحّة قنوات الإشعار" section, reading
from the new `client_notification_alert_status` singleton:

- Card label: "بريد العملاء (Resend)"
- Status maps: `healthy` → emerald, `config_missing` → amber,
  `send_failed` → rose (same tone map as operator channels).
- Failure context only renders when status !== 'healthy'
  (PR #50 UX hotfix discipline carries over).

A new founder probe (Probe 4-canary) asserts the visibility:
unset `CLIENT_PASSWORD_RESET_TOKEN_SECRET` in Vercel staging,
trigger forgot-password, refresh canary → confirm the new
card flips to amber "إعدادات ناقصة" with the verbatim env
name in the failure reason text. Restore the env var, refresh
again → card returns to emerald without stale failure context.

This closes the "write-only alert table" gap that would
otherwise leave founder blind to client-side Resend / reset-
token-secret misconfigurations.

**Middleware extension:**
- `middleware.ts` — extend matcher to `/me/:path*` + add
  `x-pathname` injection (mirrors Phase 8 PR 2c) for the
  must-change-password redirect (Phase 9.x; not used yet).

**Cron routes (3 files — PR 1 owns ONLY client cleanups):**
- `app/api/cron/client/sessions/route.ts`
- `app/api/cron/client/reset-tokens/route.ts`
- `app/api/cron/client/signup-attempts/route.ts`

The `redispatch-stale` cron route + its vercel.json entry
are PR 4's responsibility, NOT PR 1's (Codex round 1 P1 #2
fix). Shipping the entry in PR 1 before the route lands
would create production 404s for the entire PR 1 → PR 4
interval and pollute the canary tick history with phantom
failures.

**vercel.json:** add 3 PR-1 cron entries:
- `/api/cron/client/sessions` — every 6h
- `/api/cron/client/reset-tokens` — every 6h
- `/api/cron/client/signup-attempts` — every 6h

**i18n:** new `clientsAr` module
(`lib/i18n/clients-ar.ts`) with ~80 strings: nav, auth
forms, error translations, profile, alert banner.

**Validators:** new `lib/validators/clients.ts` — Zod
schemas for signup/login/reset/profile/change-password.

**Tests:** Jest tsx pattern, 3 suites:
- `lib/clients/__tests__/password-reset-token.test.ts` —
  HMAC mint/verify/expiry/tamper.
- `lib/clients/__tests__/auth-session.test.ts` — session
  token mint, hash, cookie roundtrip.
- `lib/clients/__tests__/email-normalize.test.ts` — Arabic
  case-insensitive + IDN edge cases.

**database.ts updates:** `ClientRow`, `ClientStatus`,
`ClientSessionRow`, `ClientPasswordResetTokenRow`,
`ClientSignupAttemptRow`, `ClientNotificationAlertStatusRow`
+ all related Insert/Update + table mappings. **NO Functions
map entries** for the new RPCs (avoid Phase 8 PR 2e #48
collapse pattern).

**Env vars:**
- `CLIENT_PASSWORD_RESET_TOKEN_SECRET` (HMAC for reset tokens)
- `ENABLE_CLIENT_PORTAL=true` (kill-switch)

> **Session-token shape (Codex round 2 PR #55 P2 #3
> alignment):** session tokens are opaque random 32-byte
> hex values stored as `sha256(raw_token)` in
> `client_sessions.token_hash` — same model as Phase 8
> operator sessions. There is **no** `CLIENT_SESSION_TOKEN_SECRET`
> env var: the only secret material in flight is the raw
> 256-bit cookie value itself, which never leaves the
> browser; on the server side we only ever store / compare
> the hash. An earlier draft listed an HMAC session secret;
> that was removed because it implied a security property
> the implementation does not provide.

### PR 2 — Authenticated charter form (1 RPC, 2 Server
Actions, 1 page + 1 component, ~250 lines)

**Migration:**
- `20260521000027_phase_9_pr_2_create_authenticated_trip_request.sql`
  — §4.2 RPC.

**Route:**
- `/(client)/me/charter/page.tsx` — server component +
  client form.

**Server Actions (`app/actions/clients-trip-requests.ts`):**
- `createAuthenticatedTripRequest` — wraps
  `create_authenticated_trip_request` RPC. Conditionally
  fires the auto-dispatch trigger ONLY when
  `process.env.ENABLE_TRIP_AUTO_DISTRIBUTION === 'true'`
  (Codex round 1 P1 #3 alignment — default off; trip lands
  `pending` for manual admin dispatch until the founder
  flips the flag after Probes 16 + 17). When enabled, fires
  fire-and-forget POST to
  `/api/trip-distribution/internal/dispatch` (PR 4 endpoint;
  PR 2 lands the call-site guarded by the flag so PR 4's
  endpoint switches on with zero PR 2 code change).
- `cancelMyTripRequest` — flips `status='cancelled'` for a
  trip the client owns. The Server Action makes a single
  conditional UPDATE that asserts BOTH ownership AND
  status guard inside the SQL WHERE clause (Codex round 4
  P1 #1 fix + round 5 P2 #2 simplification). A
  `status='booked'` trip MUST NOT be cancellable from this
  Server Action; the booking-cancellation flow lives
  separately in admin (Phase 10 client-side scope).

  ```sql
  UPDATE trip_requests
     SET status = 'cancelled',
         updated_at = NOW()
   WHERE id = :trip_id
     AND client_id = :session_client_id
     AND status IN ('pending', 'distributed', 'offered')
  RETURNING id, status;
  ```

  **Single result shape (Codex round 5 P2 #2 fix).** Zero
  rows returned → `{ok:false, error:'cancel_not_allowed'}`,
  opaquely. The earlier `already_cancelled` branch was
  unreachable under this UPDATE (a cancelled row also fails
  the WHERE predicate, so it returns zero rows
  indistinguishably from booked / cross-owner / not-found).
  The opaque single-error model matches Phase 8's
  `leg_not_found` discipline (Phase 8 §4 operator-empty-
  legs-authed.ts) — never leak which guard tripped. If a
  future requirement needs to differentiate already-
  cancelled (e.g. for idempotent retry UI), the Server
  Action would need a separate pre-SELECT step BEFORE the
  UPDATE; that is intentionally NOT specified here.

**Components:**
- `components/clients/charter-form.tsx` — form with origin/
  destination IATA + freeform, dates, passengers, aircraft
  preference, special requests.

**Validators:** extend `clients.ts` with
`createTripRequestSchema` + `cancelTripRequestSchema`.

**Tests:** 1 suite for the validator + zod refinements
(round-trip date validation, IATA shape, passengers cap).

### PR 3 — Client portal (3 Server Actions, 4 pages, ~10
components, ~600 lines)

**No migration** (reuses existing tables).

**Routes:**
- `/(client)/me/requests/page.tsx` — list my trip requests
  with status chips, filter by status (`all|pending|
  distributed|offered|booked|cancelled`).
- `/(client)/me/requests/[id]/page.tsx` — detail page with:
  - trip metadata (origin/destination/dates/passengers)
  - status timeline
  - all submitted offers via reused `UnifiedOfferCard`
  - accept / decline buttons (per offer)
  - cancel-trip button (when status='pending'|'distributed')
- `/(client)/me/bookings/page.tsx` — read-only list of
  client's confirmed bookings (status='booked' trips).
- `/(client)/me/bookings/[id]/page.tsx` — booking detail
  (operator snapshot, route, add-ons).

**Server Actions (`app/actions/clients-trip-requests.ts`
extended):**
- `clientAcceptOffer` — pre-SELECT ownership +
  `accept_offer` RPC + revalidate.
- `clientDeclineOffer` — UPDATE on
  `phase4_operator_offers` OR `phase5_operator_offers` to
  `status='rejected'`, with three independent guards
  enforced at the SQL boundary in a single
  conditional UPDATE (Codex round 4 P1 #2 fix):

  1. **Trip ownership** — the offer's parent
     `trip_request_id.client_id` MUST equal
     `session.client_id`.
  2. **Offer status** — the offer row's current `status`
     MUST be `'pending'`. Already-`'accepted'`,
     `'expired'`, or `'rejected'` offers MUST NOT be
     mutated (idempotency + race guard).
  3. **Trip status** — the parent trip's `status` MUST be
     `'distributed'` OR `'offered'` (NOT `'booked'` or
     `'cancelled'`). A booked trip's offers are frozen;
     declining one would corrupt the booking-acceptance
     audit chain.

  All three checks live inside a single
  `UPDATE … WHERE … RETURNING id` with the three predicates
  ANDed. Zero rows returned → `{ok:false,
  error:'decline_not_allowed'}` opaquely. The Server Action
  picks the correct table (`phase4_operator_offers` vs
  `phase5_operator_offers`) from the `source` discriminator
  the UI passes (mirrors the existing `accept_offer` RPC's
  source dispatch). The opaque error keeps the failure mode
  same regardless of which guard tripped.
- `cancelMyTripRequest` already in PR 2; add UI button.

**Components:**
- Move `components/admin/dispatch/UnifiedOfferCard.tsx` to
  `components/shared/unified-offer-card.tsx` (no behavior
  change; admin import path updated).
- `components/clients/trip-request-row.tsx`
- `components/clients/trip-request-status-chip.tsx`
- `components/clients/trip-request-timeline.tsx`
- `components/clients/booking-row.tsx`

**Lib:**
- `lib/clients/portal-queries.ts` — `listMyTripRequests`,
  `getMyTripRequestById`, `listMyBookings`,
  `getMyBookingById`. All scoped by
  `client_id = session.client_id`.

**Tests:** 1 suite for ownership-check shape + offer status
filter logic.

### PR 4 — Auto-distribution engine (2 RPCs, 2 Server
Actions, 1 internal API route, 1 cron route, 1 admin canary
extension, ~800 lines)

**Migration:**
- `20260522000028_phase_9_pr_4_distribution.sql` — §3.8
  table + §4.3 RPCs + §4.4 redispatch RPC body.

**Lib (the heart):**
- `lib/automation/trip-distribution.ts` — pure scoring
  function:
  ```ts
  export interface OperatorScoreInput { … }
  export interface OperatorScoreResult { operator_id, score, rank, breakdown }
  export function scoreOperators(inputs: OperatorScoreInput[], topN = 5): OperatorScoreResult[]
  ```
  Score weights (locked decision §6):
  - rating       40 (operator avg rating, 0–5 normalized)
  - response_time 30 (median minutes-to-offer, lower = better)
  - price        20 (relative price band; placeholder until
    Phase 10 pricing engine)
  - location     10 (operator base airport vs trip origin
    distance bucket)
- `lib/automation/__tests__/trip-distribution.test.ts` —
  20+ cases covering edge inputs, tie-breaking, top-N
  truncation, missing data fallback.

**Internal API route:**
- `app/api/trip-distribution/internal/dispatch/route.ts` —
  POST `{ trip_request_id }`, calls
  `auto_dispatch_trip_request` RPC. Auth: shared with
  match-trigger via `INTERNAL_DISPATCH_SECRET` env.

**Cron route:**
- `app/api/cron/operator/redispatch-stale/route.ts` —
  invokes `redispatch_stale_trip_requests()` cleanup RPC,
  records to `operator_cron_tick_history`.

**Admin canary extension:**
- Extend `/admin/operators/canary` (Phase 8 PR 2e) with a
  5th card: **Auto-distribution health** — 24h dispatched
  count + median time-to-first-offer + redispatch-stale
  count.

**Server Actions:**
- `app/actions/admin-trip-distribution.ts`:
  - `adminPreviewTripScore(trip_request_id)` — runs
    `score_operators_for_trip` for a trip without
    dispatching. UI affordance for admins to "see what
    auto-dispatch WOULD pick" before flipping the env flag.
  - `adminForceAutoDispatch(trip_request_id)` — manual
    re-fire of `auto_dispatch_trip_request` (escape valve
    when auto-dispatch failed silently).

**Env vars (Codex round 2 P1 #2 fix — defaults align with
§2 #11 + Acceptance §7 flip-after-probes discipline):**
- `ENABLE_TRIP_AUTO_DISTRIBUTION=false` — **DEPLOY VALUE**.
  Stays `false` until Probes 16 + 17 confirm scoring +
  Phase 5 token issuance + wa.me delivery on production.
  Founder flips to `true` explicitly post-probe via Vercel
  env edit + redeploy. Until then, every client trip lands
  `pending` for manual admin dispatch via
  `DispatchPanelV2`.
- `INTERNAL_DISPATCH_SECRET` (HMAC for the internal route)
- `TRIP_REDISPATCH_STALE_HOURS=4` (default 4h, configurable)
- `PHASE_9_MIN_DISPATCH_FANOUT=2` (default 2; minimum unique
  operators after phone-dedupe required to open a dispatch
  round — Codex round 4 P2 #2 fix). Below the floor,
  `auto_dispatch_trip_request` returns
  `insufficient_unique_operators` and trip stays `pending`
  for admin review.

**vercel.json:** add 1 PR-4 cron entry (Codex round 1 P1 #2
fix — moved out of PR 1 so the route exists when the entry
ships):
- `/api/cron/operator/redispatch-stale` — every 30 min

**i18n:** extend `clientsAr` + admin i18n with auto-dist
canary labels.

---

## 6. Founder probes

22 probes for Phase 9 (Codex round 4 P2 #1 count
correction):
  - **PR 1 (9 probes):** 1, 2, 3, 3-shape, 4, 4-canary, 5, 6, 7
  - **PR 2 (3 probes):** 8, 9, 10
  - **PR 3 (4 probes):** 11, 12, 13, 14
  - **PR 4 (6 probes):** 15, 16, 17, 18, 19, 20

Each is run on production after the relevant PR ships.

### PR 1 probes (1–7 + 3-shape + 4-canary):

1. **Schema state** — 5 new tables exist, 1 new ENUM,
   audit trigger active.
2. **RPC GRANTs (Codex round 3 P2 #1 alignment)** — query
   `pg_proc` × `aclexplode` for the **10 PR-1 publics** +
   the **1 PR-1 helper** + the **reused Phase 8 helper**
   `_is_sha256_hex(TEXT)` together in a single SQL roundtrip:
   - The 10 PR-1 publics (`client_signup`,
     `client_login_lookup`, `client_login_create_session`,
     `client_logout`, `client_session_validate`,
     `client_mint_password_reset_token`,
     `client_verify_password_reset`,
     `cleanup_expired_client_sessions`,
     `cleanup_expired_client_password_reset_tokens`,
     `cleanup_old_client_signup_attempts`) MUST list
     exactly `{postgres, service_role}` as grantees.
   - The PR-1 helper `_normalize_client_email(TEXT)` MUST
     list exactly `{postgres}` (function-owner only;
     no GRANT to anon/authenticated/service_role).
   - The reused Phase 8 helper `_is_sha256_hex(TEXT)` MUST
     STILL list exactly `{postgres}` after PR 1 deploys —
     PR 1's migration cites it as a dependency but does
     NOT touch its ACL. Any drift here means an
     accidental GRANT relaxation slipped in.
3. **Signup → login chain** — POST signup form with founder's
   personal email; verify session cookie set; verify clients
   row created with bcrypt hash.
3-shape. **sha256-hex shape validator (Codex round 3 P2 #1
   fix)** — call `client_session_validate` directly via
   `client.rpc()` with a 65-char hex string AND a 63-char
   hex string AND a 64-char string containing a non-hex
   character (e.g. `'g' * 64`). All three calls MUST return
   the structured shape `{ ok: false, error:
   'invalid_token_hash' }` with HTTP 200, NOT a raw
   PostgreSQL CHECK violation or HTTP 500. Repeat for
   `client_logout`, `client_mint_password_reset_token`, and
   `client_verify_password_reset` (sample 1 malformed input
   per RPC). Closes the same DB-boundary weakness Phase 8
   PR 2a fixed for operator RPCs.
4. **Reset link delivery** — POST forgot-password form;
   verify Resend delivery; verify token rejected after 30
   min.
4-canary. **Client channel visibility (Codex round 1 P2 #1
   fix)** — unset `CLIENT_PASSWORD_RESET_TOKEN_SECRET` in
   Vercel staging; trigger forgot-password; refresh
   `/admin/operators/canary` → confirm the 4th
   ChannelHealth card flips amber "إعدادات ناقصة" with the
   verbatim env name in the failure reason text. Restore
   the env var; trigger another reset; refresh canary →
   card returns emerald with no stale failure footer (PR #50
   UX hotfix discipline). Closes the write-only-alert-table
   gap.
5. **Session expiry** — manually update `expires_at` to past;
   verify `session_validate` RPC returns `expired`; verify
   `requireClientSession()` redirects to `/login`.
6. **Cron auth** — curl `/api/cron/client/sessions` without
   `CRON_SECRET` → 401; with → 200 + `deleted_count`.
7. **Audit trail** — INSERT a fake suspended client; verify
   `audit_logs` row appears with `signup_status_changed`
   action.

### PR 2 probes (8–10):

8. **Charter form submit** — login as Probe 14C client;
   submit one-way Riyadh → Jeddah for 4 pax; verify
   `trip_requests` row appears with `client_id` set,
   `request_number = AER-…`, `status='pending'`.
9. **Cancel my trip** — flip status to cancelled from
   `/me/requests/[id]`; verify DB row + UI chip update.
10. **Guest flow unchanged** — submit `/(public)/request`
    as guest (no session cookie); verify writes to
    `lead_inquiries` (NOT `trip_requests`).

### PR 3 probes (11–14):

11. **My requests list** — login + visit `/me/requests`;
    verify the trip from probe 8 appears.
12. **Offer comparison view** — admin (separately) opens
    a Phase 5 dispatch round to 2 operators for the trip,
    operator A submits an offer; client visits
    `/me/requests/[id]` and sees the offer in
    `UnifiedOfferCard`.
13. **Self-accept** — client clicks Accept on the offer;
    verify `bookings` row created with
    `client_id = session.client_id`,
    `trip_requests.status='booked'`,
    `phase5_operator_offers.status='accepted'`.
14. **Wrong-client guard** — login as a SECOND client;
    visit `/me/requests/[id]` of probe 8's trip URL
    directly; verify 404 (ownership check fires).

### PR 4 probes (15–20):

15. **Scoring + eligibility (Codex round 3 P1 #1
    alignment)** — admin clicks "Preview score" on a
    pending trip; verify ranked list of 5 operators with
    score breakdown. Then INSERT a synthetic operator with
    `signup_status='pending'` AND high default rating, OR
    set an existing approved operator's `contact_phone` to
    NULL. Re-run Preview → verify the synthetic/NULL-phone
    operator does NOT appear in the ranked output (filter
    enforced inside `score_operators_for_trip`).
16. **Auto-dispatch fires + eligibility + phone dedupe
    (Codex round 3 P1 #1 + round 4 P2 #2 alignment)** —
    submit a fresh charter form; verify
    `auto_dispatch_trip_request` ran (3+ rows in
    `trip_distribution_log`) + dispatch round opened with
    same operators. Verify NO `trip_distribution_log` row
    references the synthetic pending/NULL-phone operator
    from Probe 15. **Then INSERT two synthetic approved
    operators with IDENTICAL `contact_phone` values** (e.g.
    `+966500000099`); re-fire auto-dispatch via
    `adminForceAutoDispatch`; verify EXACTLY ONE of the two
    duplicates appears in `trip_distribution_log` (the
    higher-ranked one) and the Phase 5 `trip_dispatch_targets`
    INSERT did NOT fail with a unique-violation. This
    confirms the dedupe step runs BEFORE the target INSERT
    pipeline.
17. **Operators receive WhatsApp link** — confirm the
    Phase 5 dispatch flow fires + each top-N operator
    gets a wa.me link (manual visual probe in Vercel
    Functions logs OR the existing operator outreach
    queue). Each `trip_distribution_log` row's
    `dispatch_target_id` MUST resolve via the wa.me URL to
    the operator-side `/operator/offer/[token]` form
    without 404.
18. **Redispatch-stale (Codex round 3 P2 #2 alignment)** —
    set `TRIP_REDISPATCH_STALE_HOURS=0.01` (≈ 36 sec) for
    a test trip; submit; wait 1 min; verify ALL of the
    following after the cron tick:
    - `trip_dispatch_targets` rows for the stale round:
      every `status='pending'` row flipped to `'cancelled'`
      (already-`'submitted'` rows untouched).
    - `trip_dispatch_rounds` row for the stale round:
      `status='closed'`, `closed_reason='stale_timeout'`,
      `closed_at` set.
    - `trip_requests.current_dispatch_round_id` = NULL for
      the stale trip.
    - Founder batch alert fired (Resend log shows the
      delivery).
19. **Auto-dispatch disabled** — flip
    `ENABLE_TRIP_AUTO_DISTRIBUTION=false`; submit a
    charter form; verify trip lands `pending` with NO
    `trip_distribution_log` rows; admin manually opens a
    dispatch round.
20. **Canary readout** — `/admin/operators/canary` shows
    the new 5th card with non-zero "24h dispatched count"
    + median time-to-first-offer.

---

## 7. Acceptance criteria

Phase 9 is closed when:

- [ ] All 4 PRs merged to main, each cleared Codex 100/100.
- [ ] All 3 migrations applied to production (PR 1 + PR 2
      + PR 4; PR 3 is no-migration per §9 — Codex round 1
      P2 #2 fix).
- [ ] All 22 probes pass (or are explicitly deferred with
      written rationale, mirrored from Phase 7 closure
      pattern).
- [ ] `ENABLE_CLIENT_PORTAL=true` set in Vercel
      Production.
- [ ] `ENABLE_TRIP_AUTO_DISTRIBUTION=true` set after Probe
      16 + 17 confirm the engine works.
- [ ] Closure work-log entry appended to
      `docs/CLAUDE-WORK-LOG.md`.

---

## 8. Operational risks

Surfaced for Codex review:

- **Email-only client recovery is single point of failure.**
  If Resend is down, locked-out clients have no
  alternative path. Mitigation: Phase 9.x adds wasender
  WhatsApp parallel send (mirror of Phase 8.1 operator
  flow).
- **Auto-dispatch with no trained scoring data.** Operator
  rating + response-time history are placeholder values
  from initial schema; the algorithm uses defaults
  (rating=4.0, response_time=median across all operators)
  until real history accrues. Document the warm-up
  period.
- **Database growth on `trip_distribution_log`.** Each
  trip writes 5 rows. At 100 trips/day = 500 rows/day =
  ~180k rows/year. Add to the cleanup cron suite in
  Phase 9.x with a 90-day retention policy.
- **Branch protection on `main` is now active.** Phase 9
  PRs MUST pass CI before merge — type-check + lint must
  stay clean across all 4 PRs. This is a behavioral
  shift from the Phase 8 era where CI failures could
  slip through.

---

## 9. Files added / modified summary (all 4 PRs)

| Phase 9 PR | Migrations | Routes | Server Actions | Lib | Components | i18n | Tests |
|---|---|---|---|---|---|---|---|
| PR 1 | 1 | 4 public + 3 client + 3 cron | 8 | 6 | ~12 | 1 module | 3 suites |
| PR 2 | 1 | 1 | 2 | 0 | 1 | extend | 1 suite |
| PR 3 | 0 | 4 | 3 | 1 | ~6 | extend | 1 suite |
| PR 4 | 1 | 1 internal API + 1 cron | 2 admin | 2 (engine + tests-only) | 0 | extend | 1 suite (~20 cases) |
| **Total** | **3** | **17** | **15** | **9** | **~19** | **2 modules + extensions** | **6 suites** |

Inventory cross-reference (Codex round 1 P1 #1 alignment):
**PR 1 = 10 publics + 1 helper RPC + 8 Server Actions +
3 client cleanup cron routes**. PR 1 owns ONLY client cron
routes; PR 4 owns the 1 redispatch cron route + its
vercel.json entry (Codex round 1 P1 #2 alignment).

Estimated: ~3,500 net-new lines + ~800 modified lines
across 4 PRs. Within range of Phase 8 (~5,000 net-new).
