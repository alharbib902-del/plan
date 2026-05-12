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

```sql
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

`client_status` enum:

```sql
CREATE TYPE client_status AS ENUM (
  'active',     -- normal state
  'suspended',  -- admin-suspended (rare; future moderation)
  'deleted'     -- soft-delete; sessions revoked, login blocked
);
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
One row per trip × dispatched-target pair.

```sql
CREATE TABLE IF NOT EXISTS trip_distribution_log (
  id                  BIGSERIAL PRIMARY KEY,
  trip_request_id     UUID NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
  operator_id         UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  dispatched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score               DECIMAL(5,2) NOT NULL,        -- 0.00 .. 100.00
  rank                INT NOT NULL,                  -- 1..5 (top-N)
  dispatch_target_id  UUID REFERENCES trip_dispatch_targets(id) ON DELETE SET NULL,
  notification_channel TEXT NOT NULL DEFAULT 'whatsapp_link'
    CHECK (notification_channel IN ('whatsapp_link', 'email', 'sms')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (trip_request_id, operator_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_distribution_log_trip
  ON trip_distribution_log (trip_request_id, dispatched_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_distribution_log_op
  ON trip_distribution_log (operator_id, dispatched_at DESC);

ALTER TABLE trip_distribution_log ENABLE ROW LEVEL SECURITY;
```

### §3.9 — Cleanup cron RPCs registered in
`operator_cron_tick_history` (PR 1 + PR 4)

Add 3 new job names to the existing CHECK constraint:

```sql
-- PR 1 adds these via ALTER TABLE ... DROP CONSTRAINT +
-- ADD CONSTRAINT (Postgres does not support modifying CHECK
-- constraints in place):
ALTER TABLE operator_cron_tick_history
  DROP CONSTRAINT IF EXISTS operator_cron_tick_history_job_name_check;

ALTER TABLE operator_cron_tick_history
  ADD CONSTRAINT operator_cron_tick_history_job_name_check
  CHECK (job_name IN (
    -- Phase 8 PR 2e jobs
    'cleanup_expired_operator_sessions',
    'cleanup_expired_password_reset_tokens',
    'cleanup_expired_otp_codes',
    'cleanup_old_signup_attempts',
    -- Phase 9 PR 1 jobs
    'cleanup_expired_client_sessions',
    'cleanup_expired_client_password_reset_tokens',
    'cleanup_old_client_signup_attempts',
    -- Phase 9 PR 4 job
    'redispatch_stale_trip_requests'
  ));
```

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
| `score_operators_for_trip(p_trip_request_id) → JSON` | reads trip + operators, returns top-5 `[{operator_id, score, rank, contact_phone, …}]` ordered by score desc; pure read, no writes |
| `auto_dispatch_trip_request(p_trip_request_id) → JSON` | scores → opens Phase 5 dispatch round with per-target token issuance (see contract below) → INSERTs `trip_distribution_log` rows → sets `trip_requests.current_dispatch_round_id`; returns `{ok:true, dispatched_count, round_id, targets:[{operator_id, target_id, wa_me_url}]}` |

**Phase 5 token issuance contract for `auto_dispatch_trip_request`
(Codex round 1 P1 #4 fix)**

The existing Phase 5 dispatch path requires each
`trip_dispatch_targets` row to carry:

| Column | Source | Notes |
|---|---|---|
| `id` | `uuid_generate_v4()` | PK |
| `dispatch_round_id` | from the newly opened round | FK |
| `operator_id` | from scoring top-N | FK |
| `target_phone` | from operators.contact_phone | wa.me destination |
| `nonce` | `gen_random_bytes(16)::hex` | 32-char hex, HMAC payload |
| `sent_at` | `NOW()` | dispatch timestamp |
| `expires_at` | `NOW() + INTERVAL '4 hours'` | matches §1 retention |
| `status` | `'pending'` | dispatch_target_status enum |

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

`trip_distribution_log` rows are populated FROM the resulting
`trip_dispatch_targets`: one log row per (trip, operator, target)
triple, with `dispatch_target_id` set so admin canary readouts
can join back to the dispatch round.

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
| `redispatch_stale_trip_requests()` (PR 4) | finds trips dispatched > 4 hours ago with no `phase5_operator_offers`; emits founder batch alert (best-effort) + flips `current_dispatch_round_id` to NULL so admin queue picks them up |

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
- `CLIENT_SESSION_TOKEN_SECRET` (HMAC for session tokens)
- `CLIENT_PASSWORD_RESET_TOKEN_SECRET` (HMAC for reset tokens)
- `ENABLE_CLIENT_PORTAL=true` (kill-switch)

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
  trip the client owns; pre-SELECT ownership check.

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
  `phase4/5_operator_offers` to `status='rejected'`,
  ownership-checked.
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

**Env vars:**
- `ENABLE_TRIP_AUTO_DISTRIBUTION=true`
- `INTERNAL_DISPATCH_SECRET` (HMAC for the internal route)
- `TRIP_REDISPATCH_STALE_HOURS=4` (default 4h, configurable)

**vercel.json:** add 1 PR-4 cron entry (Codex round 1 P1 #2
fix — moved out of PR 1 so the route exists when the entry
ships):
- `/api/cron/operator/redispatch-stale` — every 30 min

**i18n:** extend `clientsAr` + admin i18n with auto-dist
canary labels.

---

## 6. Founder probes

21 probes for Phase 9 (1–7 PR1 + 4-canary inline + 8–10
PR2 + 11–14 PR3 + 15–20 PR4). Each is run on production
after the relevant PR ships.

### PR 1 probes (1–7 + 4-canary):

1. **Schema state** — 5 new tables exist, 1 new ENUM,
   audit trigger active.
2. **RPC GRANTs** — exactly **10 PR-1 publics**
   (`client_signup`, `client_login_lookup`,
   `client_login_create_session`, `client_logout`,
   `client_session_validate`,
   `client_mint_password_reset_token`,
   `client_verify_password_reset`,
   `cleanup_expired_client_sessions`,
   `cleanup_expired_client_password_reset_tokens`,
   `cleanup_old_client_signup_attempts`) revoke from
   anon + authenticated, grant to service_role; 1 helper
   (`_normalize_client_email`) revokes from anon +
   authenticated + service_role with no GRANT
   (function-owner-only).
3. **Signup → login chain** — POST signup form with founder's
   personal email; verify session cookie set; verify clients
   row created with bcrypt hash.
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

15. **Scoring** — admin clicks "Preview score" on a
    pending trip; verify ranked list of 5 operators with
    score breakdown.
16. **Auto-dispatch fires** — submit a fresh charter form;
    verify `auto_dispatch_trip_request` ran (3+ rows in
    `trip_distribution_log`) + dispatch round opened with
    same operators.
17. **Operators receive WhatsApp link** — confirm the
    Phase 5 dispatch flow fires + each top-N operator
    gets a wa.me link (manual visual probe in Vercel
    Functions logs OR the existing operator outreach
    queue).
18. **Redispatch-stale** — set
    `TRIP_REDISPATCH_STALE_HOURS=0.01` (≈ 36 sec) for a
    test trip; submit; wait 1 min; verify the cron flips
    `current_dispatch_round_id` back to NULL + a founder
    alert fires.
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
- [ ] All 21 probes pass (or are explicitly deferred with
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
