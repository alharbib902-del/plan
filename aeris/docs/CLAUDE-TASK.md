# Phase 8 — Operator Account Onboarding

> **Status:** Draft for Codex review (round 1).
> **Predecessor:** Phase 7 (Empty Legs marketplace) — closed
> 2026-05-09 at sha `6468dfb`. Phase 7 introduced the
> short-lived `phase7_operator_stubs` table because the real
> `operators` table required FK targets (user accounts +
> regulatory documents) that Phase 7 could not populate.
> Phase 8 retires that shim by giving operators real,
> authenticated accounts.
>
> **Scope (locked).** A full operator portal — public
> hybrid signup → admin approval → custom-bcrypt session
> auth → minimal-but-real dashboard, legs management,
> bookings (read-only), profile, mock earnings — plus the
> admin surfaces that approve/reject/suspend operators,
> upload regulatory documents, and convert
> `phase7_operator_stubs` rows into real `operators` rows
> while preserving every `empty_legs` linkage.
>
> Every PR in this phase MUST clear Codex 100/100 before
> merge.

---

## 0. Objective

Replace the Phase-7-scoped `phase7_operator_stubs` shim
with first-class operator accounts. After Phase 8:

1. **Operators self-onboard** at `/operator/signup` — they
   pick an email, set a bcrypt password, and submit
   `company_name + contact_email + contact_phone` plus a
   freeform notes blob. The account lands in
   `operators.signup_status = 'pending'`.

2. **Admin approves** at `/admin/operators/<id>` — flips
   `signup_status` to `'approved'` and triggers a welcome
   email containing a magic link that completes first
   login (a one-shot HMAC token signed by a separate
   secret; the operator follows the link, lands on a
   "set up your session" page, and is logged into the
   portal directly).

3. **Operator logs in** at `/operator/login` with email +
   password. Sessions are cookie-based, 7-day default,
   30-day with "تذكّرني" toggle, custom HMAC over a row
   in `operator_sessions` (mirrors the Phase 7 admin
   cookie discipline; replaces the URL-token flow).

4. **Admin uploads regulatory documents** at
   `/admin/operators/<id>/documents` — `commercial_registration`,
   `gaca_license`, `license_expiry`. The operator can
   view (read-only) at `/operator/profile/documents`.

5. **Admin converts existing stubs** at
   `/admin/empty-legs/operators/<stub_id>/convert` —
   picks (or creates) a target `operators` row, the RPC
   reassigns every `empty_legs.operator_stub_id =
   stub_id` to the operator's `operator_id` AND archives
   the stub. Stubs that admin elects not to convert stay
   coexistence-mode forever (the `empty_legs.operator_stub_id`
   FK and the `phase7_operator_stubs` table are NOT
   removed — Phase 8 ships the conversion path, not a
   forced migration).

6. **Recovery flows** are first-class:
   - **Email reset link** — operator opens
     `/operator/forgot-password`, types email, gets a
     one-shot HMAC reset link via Resend (separate
     secret, 30-min TTL).
   - **WhatsApp OTP** — admin can mint a 6-digit OTP at
     `/admin/operators/<id>` that the operator types at
     `/operator/login/otp` to bypass password (rare path,
     for recovery without email access).
   - **Admin reset** — admin can directly set a new
     password from `/admin/operators/<id>`; the operator
     receives an email with the new password (one-shot,
     must change on next login).

7. **The Phase 7 token-URL operator flow stays
   functional** during the canary window (no breaking
   change). Once admin is comfortable, the
   `ENABLE_OPERATOR_PORTAL` flag stays on AND the
   `ENABLE_OPERATOR_LEGACY_TOKEN` flag (new, default on)
   can be flipped off to retire the URL-token path.

---

## 1. Product decisions (locked)

These are the founder's confirmed choices, captured before
the spec was drafted. Codex must verify the rest of the
document is consistent with each decision; any drift is a
blocker.

| # | Decision | Value | Rationale |
|:-:|---|---|---|
| 1 | **Auth provider** | Custom + bcrypt (founder-confirmed) | The founder explicitly picked **(ج) Custom + bcrypt** from a 3-way choice (Supabase Auth / HMAC-only / Custom + bcrypt) in the pre-spec decisions thread. Rationale: full control over hash cost / rotation / session shape; avoids the Supabase Auth coupling that would force `auth.users` rows for every operator AND complicate the existing admin cookie flow (which is already Custom + bcrypt-style HMAC). The Phase 7 operator HMAC-token flow stays available behind a kill-switch flag during the canary window — see §8 retire-legacy plan. **Codex round 1 P1 #1 audit:** Codex round 1 flagged this as "spec reverses the agreed auth provider — we settled on Supabase Auth", which is incorrect — the founder's confirmed choice IS Custom + bcrypt; this row is the durable record. The Codex finding is recorded here so that audit trail is complete. |
| 2 | **Registration flow** | Hybrid (self-signup → pending → admin approval) | Operators discover Aeris via marketing / referrals; self-signup lowers onboarding friction. Admin approval gate keeps regulatory posture tight (no spam accounts; admin verifies every operator before legs publish). |
| 3 | **Document handling** | Admin completes documents | Operators rarely have `gaca_license` / `commercial_registration` PDFs ready at signup. Admin coordinates document collection out-of-band (WhatsApp / email) and uploads on the operator's behalf. |
| 4 | **Stub migration strategy** | Manual conversion (admin-controlled) | Forced automatic migration would either lose data (stubs lack `user_id` / regulatory docs) or surface NULLs in `operators` columns the schema enforces. Manual gives admin a UI to pick the target operator + reassign legs atomically per stub. Stubs that aren't converted coexist with operators forever. |
| 5 | **Operator UI scope** | Full portal | Login + dashboard + legs + bookings (read-only) + profile + mock earnings. Replaces the Phase 7 token-URL flow with session auth. ~12 pages. |
| 6 | **Recovery flow** | Email reset link **AND** WhatsApp OTP **AND** admin direct reset | Email reset is the default; WhatsApp OTP covers the lost-email-access case; admin reset is the operational override. All three paths land at the same "set new password" page. |
| 7 | **Codex 100/100** | Required on every PR | Same discipline as Phase 7. Hotfixes (single-line + regression test) exempt by direct command. |
| 8 | **Document upload** | Supabase Storage (admin uploads) | Re-uses the existing Supabase project. Operator sees read-only signed URLs from `/operator/profile/documents`. Stored under bucket `operator-documents/<operator_id>/...`. |
| 9 | **Earnings page** | Mock data + "قريباً" placeholder | Real earnings calculation is Phase 11 territory (HyperPay + ZATCA payout + commission). Phase 8 ships the read-only page shell so the navigation surface is complete; the data row is `pending Phase 11`. |
| 10 | **Bookings page** | Read-only | Operator sees confirmed bookings from `/operator/bookings`. No actions (no accept/reject/cancel on the operator side — admin owns those flows). |
| 11 | **Session TTL** | 7 days default; 30 days with "تذكّرني" | Mirrors the customer-checkout token shape. Cookie name `aeris_operator`. |
| 12 | **Self-signup rate limit** | 3 attempts / IP / day; 24h ban after threshold | Anti-spam without locking out legitimate operators. The ban is IP-only, not email-based, so a real operator who shares a VPN with a spammer can still sign up from a different IP. |
| 13 | **Email verification** | Welcome-link magic auth (no separate verify step) | After admin approval, the welcome email contains a one-shot HMAC magic link. Clicking it completes "first login" — the operator lands authenticated on the portal and is prompted to set a password (or they kept the password from signup, in which case the magic link just reuses it for the first session). Saves a verification round-trip. |

---

## 2. Schema reality (production, post-Phase-7)

Confirmed via `\d+` against the production Supabase as of
`6468dfb` (Phase 7 closure):

### `operators` (existing, from initial schema; Phase 8 extends)

```
id UUID PK DEFAULT uuid_generate_v4()
user_id UUID NOT NULL REFERENCES users(id)         -- ← Phase 8 will RELAX to NULLABLE
company_name TEXT NOT NULL
contact_email TEXT NOT NULL
contact_phone TEXT NOT NULL
commercial_registration TEXT NOT NULL              -- ← Phase 8 will RELAX to NULLABLE
gaca_license TEXT NOT NULL                         -- ← Phase 8 will RELAX to NULLABLE
license_expiry DATE NOT NULL                       -- ← Phase 8 will RELAX to NULLABLE
status TEXT NOT NULL CHECK (status IN ('pending','approved','suspended'))
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

The `user_id NOT NULL REFERENCES users(id)` clause is the
single biggest Phase 7 blocker that Phase 8 retires.
Custom + bcrypt auth means an operator account does NOT
need a row in `users` (which is the customer auth table).
Phase 8 RELAXES `operators.user_id` to nullable + adds
`operators.password_hash` etc.

The `status` ENUM already has `'pending' / 'approved' /
'suspended'`. Phase 8 ADDS `'rejected'` to the CHECK and
renames the column to `signup_status` (to avoid confusion
with `empty_legs.status`). The migration in §3 walks
through the rename atomically.

### `phase7_operator_stubs` (existing, Phase 7 §14)

```
id UUID PK DEFAULT uuid_generate_v4()
company_name VARCHAR(200) NOT NULL
contact_email VARCHAR(255) NOT NULL                -- (Codex round-1 P2 #2 fix on PR 2c)
contact_phone VARCHAR(20) NOT NULL                 -- (Codex round-1 P2 #2 fix on PR 2c)
status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived'))
notes TEXT
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Phase 8 keeps this table. The conversion RPC in §3
flips a stub's `status` to `'archived'` after its legs
have been reassigned to a real `operators.id`.

### `empty_legs` (existing, Phase 7 §1)

```
operator_id UUID NULL REFERENCES operators(id) ON DELETE SET NULL
operator_stub_id UUID NULL REFERENCES phase7_operator_stubs(id) ON DELETE SET NULL
```

Both FKs coexist. Phase 7 admin/operator publish only set
`operator_stub_id`. Phase 8's conversion RPC: SET
`operator_id = <new operator id>` AND `operator_stub_id
= NULL` for every leg whose `operator_stub_id` matched.

### `operator_empty_leg_sessions` (existing, Phase 7 §15)

```
id UUID PK
operator_stub_id UUID NOT NULL REFERENCES phase7_operator_stubs(id) ON DELETE CASCADE
token_hash VARCHAR(64) NOT NULL
issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
expires_at TIMESTAMPTZ NOT NULL
revoked_at TIMESTAMPTZ
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Phase 8 LEAVES this table untouched. It backs the
URL-token operator portal that stays available behind
`ENABLE_OPERATOR_LEGACY_TOKEN` (default `true`) for the
canary window. Phase 8 §11 documents the flag-flip plan.

### Other Phase 7 surfaces (unaffected)

`empty_leg_notifications`, `empty_leg_outreach_alert_status`,
`empty_leg_events_outbox`, `lead_inquiries`. Phase 8 does
NOT touch any of them.

---

## 3. PR 1 — Schema (DDL only, no runtime code)

PR 1 ships the migration that prepares the schema for the
new auth + admin surfaces in PR 2a-d. Mirrors the Phase 7
PR 1 discipline: every `CREATE TABLE` is `IF NOT EXISTS`,
every `CREATE INDEX` is `IF NOT EXISTS`, every constraint
add is wrapped in a `pg_constraint`-guarded DO block.

Migration file:
`supabase/migrations/20260512000020_phase_8_operator_accounts.sql`

### 3.1 Relax `operators.user_id` to nullable

```sql
ALTER TABLE operators ALTER COLUMN user_id DROP NOT NULL;
```

Existing rows: zero (production `operators` is empty per
Phase 7 §Schema reality §1, iteration-10 P1 #3 audit).
The relaxation is a no-op for live data, future-safe for
custom-auth operators that never get a `users.id`.

### 3.2 Relax regulatory columns

```sql
ALTER TABLE operators ALTER COLUMN commercial_registration DROP NOT NULL;
ALTER TABLE operators ALTER COLUMN gaca_license DROP NOT NULL;
ALTER TABLE operators ALTER COLUMN license_expiry DROP NOT NULL;
```

Per decision §3 (admin completes documents). The columns
stay typed-correct; admin uploads populate them later.

### 3.3 Add custom-auth columns (14 columns)

```sql
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS auth_email TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by_admin_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
  ADD COLUMN IF NOT EXISTS welcome_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS welcome_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_token_used_at TIMESTAMPTZ;

-- auth_email is the immutable login identifier (Codex
-- round-2 P1 #1 + round-3 P1 #1 fix). Migration enforces
-- the invariant in three steps:
--   (1) ADD COLUMN IF NOT EXISTS auth_email TEXT
--       — nullable on add to satisfy ALTER semantics on
--       a non-empty table (defense in depth: production
--       has zero operators, but a future replay on a
--       populated DB must succeed).
--   (2) UPDATE operators SET auth_email = contact_email
--       WHERE auth_email IS NULL — backfill from the
--       existing email column for any pre-existing row.
--   (3) ALTER COLUMN auth_email SET NOT NULL — close
--       the invariant. Every Phase-8-and-later operator
--       row carries a non-null auth_email.
UPDATE operators SET auth_email = contact_email
  WHERE auth_email IS NULL;

ALTER TABLE operators ALTER COLUMN auth_email SET NOT NULL;

-- Unique index on the normalized column. No WHERE
-- clause needed now that auth_email is NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_auth_email_unique
  ON operators(LOWER(auth_email));
```

The signup form passes `auth_email` and
`contact_email` as separate parameters to
`operator_signup` and MAY seed them with different
values: `auth_email` is the immutable login identity
(used at every subsequent login + password-reset
lookup), while `contact_email` is the mutable
operational contact (the address admin + Resend send
notifications to). They can match if the operator
chose to reuse the login email at signup, but the
schema and the signup contract treat them as
independent columns from row 1 (Codex round-5 P2
fix: prior wording said the form wrote the same
value to both, contradicting the round-4 fix to
`operator_signup` step 6 that already persists
`contact_email=p_contact_email`). Profile edits
change `contact_email` only; `auth_email` is
read-only post-signup. Login + password-reset look
up by `auth_email`. The
`LOWER()` index normalizes on read — see helper
`_normalize_operator_email()` in §4 — so
`Founder@Aeris.sa` and `founder@aeris.sa` resolve to
the same row at lookup time.

**Probe-fixture impact** (Codex round-3 P1 #1 fix):
every fixture INSERT in Probes 6, 7, and the smoke
queries in §3 MUST set `auth_email` explicitly (and
`password_hash` for Probe 7). The probe text in §4
references this requirement inline; the §3 audit-trigger
smoke also seeds `auth_email = 'probe-trigger@aeris.test'`
to satisfy the NOT NULL constraint inside the
transaction.

`password_hash` is nullable for the welcome-magic-link
path: an operator who completed signup with a password
already has a hash; an operator who is admin-created
without a password gets one only after the first login.

`welcome_token_*` columns are the magic-link state.
`token_hash` matches the wire format `sha256(rawToken)`.

### 3.4 Rename + extend the `operators.status` enum

The column is renamed to `signup_status` AND its CHECK
extended:

```sql
ALTER TABLE operators
  RENAME COLUMN status TO signup_status;

ALTER TABLE operators
  DROP CONSTRAINT IF EXISTS operators_status_check;

ALTER TABLE operators
  ADD CONSTRAINT operators_signup_status_check
    CHECK (signup_status IN ('pending','approved','rejected','suspended'));
```

The rename + re-CHECK is wrapped in a `DO $$ ... $$` block
to handle the case where a previous Phase-1-era constraint
existed under a different name.

### 3.5 New table `operator_sessions`

```sql
CREATE TABLE IF NOT EXISTS operator_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash      VARCHAR(64) NOT NULL,                  -- sha256(rawToken)
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  remember_me     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address      INET,
  user_agent      TEXT,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_sessions_token_hash
  ON operator_sessions(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_operator_sessions_operator_active
  ON operator_sessions(operator_id, expires_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;
-- Service-role-only access. The portal Server Actions run
-- service-role; operators never touch this table directly.
```

### 3.6 New table `operator_password_reset_tokens`

```sql
CREATE TABLE IF NOT EXISTS operator_password_reset_tokens (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id   UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  token_hash    VARCHAR(64) NOT NULL,                    -- sha256(rawToken)
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_password_reset_pending
  ON operator_password_reset_tokens(token_hash)
  WHERE used_at IS NULL;

ALTER TABLE operator_password_reset_tokens ENABLE ROW LEVEL SECURITY;
```

30-min TTL. Single-use. The reset RPC checks both
`expires_at > NOW()` AND `used_at IS NULL`.

### 3.7 New table `operator_otp_codes`

```sql
CREATE TABLE IF NOT EXISTS operator_otp_codes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id   UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  code_hash     VARCHAR(64) NOT NULL,                    -- sha256(6-digit-code)
  channel       TEXT NOT NULL CHECK (channel IN ('whatsapp')),
  purpose       TEXT NOT NULL CHECK (purpose IN ('login','recovery')),
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_otp_pending
  ON operator_otp_codes(operator_id, expires_at DESC)
  WHERE used_at IS NULL;

ALTER TABLE operator_otp_codes ENABLE ROW LEVEL SECURITY;
```

10-min TTL. Single-use. Max 5 verification attempts —
beyond that the row is locked (the verify RPC bumps
`attempt_count` and rejects when >= 5). The `code_hash`
stores `sha256(plaintext-6-digit)` so even a DB dump
doesn't leak codes.

### 3.8 New table `operator_documents`

```sql
CREATE TABLE IF NOT EXISTS operator_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id   UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('commercial_registration','gaca_license','license_expiry_proof')),
  storage_path  TEXT NOT NULL,                            -- Supabase Storage object path
  file_name     TEXT NOT NULL,
  file_size     BIGINT NOT NULL,
  content_type  TEXT NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by_admin BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_documents_unique
  ON operator_documents(operator_id, document_type);

ALTER TABLE operator_documents ENABLE ROW LEVEL SECURITY;
```

The unique index ensures one document per type per
operator (re-upload replaces via the admin Server Action,
which DELETEs the old row + INSERTs the new one in one
RPC).

### 3.9 New table `operator_signup_attempts` (rate limiting)

```sql
CREATE TABLE IF NOT EXISTS operator_signup_attempts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address    INET NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  email_attempted TEXT,                                   -- nullable: failed before email parsed
  result        TEXT NOT NULL CHECK (result IN ('success','duplicate_email','rate_limited','validation_failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_signup_attempts_ip_recent
  ON operator_signup_attempts(ip_address, attempted_at DESC);

ALTER TABLE operator_signup_attempts ENABLE ROW LEVEL SECURITY;
```

The signup RPC counts rows with `attempted_at > NOW() -
INTERVAL '24 hours'` AND `result = 'success'` for the IP
and rejects when `>= 3`. Failed attempts do NOT count
against the cap (only successful or duplicate-email
submissions).

### 3.10 Singleton `operator_notification_alert_status` (Codex round-1 P1 #3 fix)

```sql
CREATE TABLE IF NOT EXISTS operator_notification_alert_status (
  id                   INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status               TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'config_missing', 'send_failed')),
  last_failure_at      TIMESTAMPTZ,
  last_failure_reason  TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO operator_notification_alert_status (id, status)
  VALUES (1, 'healthy')
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE operator_notification_alert_status
  ENABLE ROW LEVEL SECURITY;
```

Mirrors the Phase 7 §16 `empty_leg_outreach_alert_status`
table pattern. PR 2d (Resend + WhatsApp notifications)
UPDATEs this row on every email send attempt. PR 2b's
`/admin/operators` list page reads it on every render
and renders a red Arabic-RTL banner when status is not
`'healthy'` — same posture as the Phase 7 outreach-queue
banner.

The seed INSERT guarantees the singleton row exists
before PR 2d's first send attempt. The `id INT PK CHECK
(id = 1)` constraint enforces single-row state.

### 3.11 Audit trigger on `operators`

```sql
CREATE OR REPLACE FUNCTION operators_audit_trigger()
  RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.signup_status IS DISTINCT FROM NEW.signup_status THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('operator', NEW.id, 'signup_status_changed',
              jsonb_build_object('signup_status', OLD.signup_status),
              jsonb_build_object('signup_status', NEW.signup_status));
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value)
      VALUES ('operator', NEW.id, 'password_changed',
              NULL, NULL);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operators_audit_trigger ON operators;
CREATE TRIGGER operators_audit_trigger
  AFTER UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION operators_audit_trigger();
```

Status changes + password changes are logged. The
old/new values for status are JSONB; the password change
is logged as a state-change event without including any
hashes (no leak in the audit log itself).

### 3.12 Migration footer + sanity check queries

The migration ends with two sanity checks the founder
runs from the SQL editor afterward:

```sql
-- Check 1: every operator column added
SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'operators'
    AND column_name IN ('password_hash','signup_status','welcome_token_hash')
  ORDER BY column_name;

-- Check 2: all 6 new tables exist (5 + the
-- alert-status singleton from Codex round-1 P1 #3 fix)
SELECT table_name FROM information_schema.tables
  WHERE table_name IN (
    'operator_sessions',
    'operator_password_reset_tokens',
    'operator_otp_codes',
    'operator_documents',
    'operator_signup_attempts',
    'operator_notification_alert_status'
  )
  ORDER BY table_name;

-- Check 3: alert-status singleton seed exists
SELECT id, status FROM operator_notification_alert_status
  WHERE id = 1;
```

### Files in PR 1

- **Add:** `supabase/migrations/20260512000020_phase_8_operator_accounts.sql`
- **Edit:** `types/database.ts` — extend the `Database` map
  with the **6** new tables (Codex round-2 P2 #1 fix:
  count updated to include
  `operator_notification_alert_status` from §3.10) plus
  the 14 new columns on `operators` (including
  `auth_email` from the round-2 P1 #1 fix). The 6
  tables are: `operator_sessions`,
  `operator_password_reset_tokens`, `operator_otp_codes`,
  `operator_documents`, `operator_signup_attempts`,
  `operator_notification_alert_status`. Hand-maintained
  per the Phase 7 alias-layer ritual; if Codex flags
  this in round 3 we'll address with a thin alias layer
  rather than a 39-file refactor.
- **Edit:** `lib/empty-legs/types.ts` — re-export
  `OperatorRow` (renamed from `OperatorRecord` if it
  exists) for downstream PRs.

### Founder probes after PR 1 (5 probes — was 4 in round 0; round 1 added 4a)

1. **Schema state** — service-role psql: `\d+ operators`
   shows the 14 new columns + the renamed `signup_status`
   with the 4-value CHECK. Verify explicitly that
   `auth_email` is `NOT NULL` (Codex round-4 P2 #1 fix:
   the auth-email invariant added in round 2 + enforced
   in round 3 must show as "not null" in the `\d+`
   modifier column — assert this directly rather than
   trust column-count parity).
2. **Six new tables** — `\dt operator_*` lists all 6
   tables (`operator_sessions`, `operator_password_reset_tokens`,
   `operator_otp_codes`, `operator_documents`,
   `operator_signup_attempts`, `operator_notification_alert_status`)
   plus the existing `operator_empty_leg_sessions`.
3. **RLS posture** — every new table has RLS enabled
   AND zero policies (service-role-only).
4. **Audit trigger smoke** — INSERT a synthetic
   `operators` row with **all required fixture columns**
   (Codex round-3 P1 #1 fix: `auth_email` is NOT NULL):
   ```sql
   BEGIN;
   INSERT INTO operators
     (auth_email, contact_email, contact_phone,
      company_name, signup_status)
   VALUES
     ('probe-trigger@aeris.test', 'probe-trigger@aeris.test',
      '+966500000004', 'Probe 4 Co', 'pending')
   RETURNING id;
   -- (use the returned id below)
   UPDATE operators SET signup_status = 'approved'
     WHERE id = '<returned-id>';
   SELECT entity_type, action FROM audit_logs
     WHERE entity_id = '<returned-id>'
     ORDER BY created_at DESC LIMIT 1;
   ROLLBACK;
   ```
   Assert: the SELECT returns
   `('operator', 'signup_status_changed')`. ROLLBACK
   guarantees production stays byte-identical.
4a. **Alert-status singleton seed** (Codex round-1 P1 #3
    + P2 #1 fix) — `SELECT id, status FROM
    operator_notification_alert_status WHERE id = 1`
    returns one row with `status='healthy'`. The
    `id INT PK CHECK (id = 1)` constraint also rejects
    `INSERT (id=2)` (verified inside a transaction +
    ROLLBACK). The `operator-documents` Supabase
    Storage bucket is **operational, not migration-bound**
    (admin creates it via Supabase Dashboard before
    the first document upload — covered in PR 2b's
    pre-deploy operational checklist, not as a SQL
    probe).

---

## 4. PR 2a — RPC layer (SECURITY DEFINER)

PR 2a ships the SQL function family that the Server
Actions in PR 2b/2c/2d will wrap. Mirrors the Phase 7
PR 2a discipline:

- Every public function is `SECURITY DEFINER` + service-
  role-only EXECUTE.
- Structured-error contract: every validation failure
  returns `{ ok: false, error: '<code>' }` JSON; no
  `RAISE EXCEPTION`.
- Helpers are REVOKEd from every role (callable only
  from inside the publics).
- Lock order is consistent: lock the `operators` row
  first, then validate, then mutate.

Migration file:
`supabase/migrations/20260513000021_phase_8_operator_rpcs.sql`

### 4.1 Function inventory (17 publics + 1 helper)

Codex round-2 P1 #2 fix: the round-1 split of `operator_login`
into a 2-step flow grew the public count from 15 to 16. The
inventory below also reclassifies `consume_operator_welcome_token`
from "stub" (round-0 wording was misleading; it was always
fully implemented in PR 2a) to a regular public RPC, bringing
the total to 17 publics + 1 helper. Each function is
enumerated on its own row so grants, generated types, and the
RPC-grants probe can reference each one directly.

| # | Function | Caller (in subsequent PRs) |
|:-:|---|---|
| (helper) | `_normalize_operator_email(TEXT)` | internal — REVOKEd from every role |
| 1 | `operator_signup(p_email, p_password_hash, p_company_name, p_contact_email, p_contact_phone, p_notes, p_ip)` | PR 2c `/operator/signup` |
| 2 | `operator_login_lookup(p_email)` | PR 2c `/operator/login` (step 1 of 2 — see §4.2) |
| 3 | `operator_login_create_session(p_operator_id, p_session_token_hash, p_remember_me, p_ip, p_user_agent)` | PR 2c `/operator/login` (step 2 of 2 — see §4.2) |
| 4 | `operator_logout(p_session_token_hash)` | PR 2c `/operator/logout` |
| 5 | `operator_session_validate(p_token_hash)` | PR 2c every protected page + Server Action |
| 6 | `admin_approve_operator(p_operator_id, p_welcome_token_hash, p_welcome_token_expires_at)` | PR 2b `/admin/operators/<id>` |
| 7 | `admin_reject_operator(p_operator_id, p_reason)` | PR 2b `/admin/operators/<id>` |
| 8 | `admin_suspend_operator(p_operator_id, p_reason)` | PR 2b `/admin/operators/<id>` |
| 9 | `admin_unsuspend_operator(p_operator_id)` | PR 2b `/admin/operators/<id>` |
| 10 | `admin_set_operator_documents(p_operator_id, p_commercial_registration, p_gaca_license, p_license_expiry)` | PR 2b `/admin/operators/<id>/documents` |
| 11 | `admin_reset_operator_password(p_operator_id, p_new_password_hash)` | PR 2b `/admin/operators/<id>` |
| 12 | `mint_operator_password_reset_token(p_email, p_token_hash, p_expires_at)` | PR 2d `/operator/forgot-password` |
| 13 | `verify_operator_password_reset(p_token_hash, p_new_password_hash)` | PR 2d `/operator/reset-password/[token]` |
| 14 | `mint_operator_otp(p_operator_id, p_code_hash, p_purpose, p_expires_at)` | PR 2b `/admin/operators/<id>` (admin-issued only in §6) |
| 15 | `verify_operator_otp(p_operator_id, p_code_hash)` | PR 2c `/operator/login/otp` |
| 16 | `convert_phase7_stub_to_operator(p_stub_id, p_operator_id)` | PR 2b `/admin/empty-legs/operators/<stub_id>/convert` |
| 17 | `consume_operator_welcome_token(p_token_hash, p_session_token_hash, p_remember_me, p_ip, p_user_agent)` | PR 2c `/operator/welcome/[token]` |

### 4.2 Body sketches (key contracts)

#### `operator_signup`

1. Lock the email — SELECT … FROM operators WHERE
   `_normalize_operator_email(auth_email)` =
   `_normalize_operator_email(p_email)` FOR UPDATE.
   (Codex round-2 P1 #1 fix: lookup by `auth_email`,
   the immutable login identifier.)
2. If a row exists → INSERT into
   `operator_signup_attempts` with
   `result='duplicate_email'` and return
   `{ ok: false, error: 'email_in_use' }`.
3. Rate-limit: COUNT(*) FROM `operator_signup_attempts`
   WHERE `ip_address = p_ip` AND `attempted_at > NOW() - INTERVAL '24 hours'`
   AND `result = 'success'`. If `>= 3` → INSERT
   attempt row with `result='rate_limited'` + return
   `{ ok: false, error: 'rate_limited' }`.
4. Validate password hash format (bcrypt $2a$ / $2b$ /
   $2y$ prefix). If invalid → return
   `{ ok: false, error: 'password_hash_malformed' }`.
   The Server Action in PR 2c bcrypts the plaintext
   before this RPC; defense in depth.
5. Validate `p_company_name` length, `p_contact_email`
   format, `p_contact_phone` length per the same
   patterns as PR 2c's stub bootstrap.
6. INSERT into `operators` with `auth_email=p_email,
   contact_email=p_contact_email, signup_status='pending',
   password_hash=p_password_hash,
   password_set_at=NOW()`. `auth_email` is the
   immutable login identifier (the email the operator
   types into the login form); `contact_email` is the
   operational contact submitted alongside
   `company_name` + `contact_phone` per the §0
   objective. They can match if the operator reused
   the login email at signup, but they are seeded
   from separate RPC parameters and live in separate
   columns from row 1. `auth_email` stays immutable;
   `contact_email` can be edited via
   `/operator/profile` (Codex round-4 P1 #1 fix:
   prior wording set both to `p_email`, silently
   discarding `p_contact_email` even though step 5
   validated it). Return
   `{ ok: true, operator_id, signup_status:'pending' }`.
7. INSERT into `operator_signup_attempts` with
   `result='success'`.

The function does NOT send a notification email — the
admin gets a Resend alert via a separate notification
module (PR 2d) that observes the `operators` audit row
the trigger writes.

#### `operator_login_lookup` + `operator_login_create_session` (TWO-STEP, Codex round-1 P1 #2 fix)

**Round-1 P1 #2 background.** The earlier draft had a
single `operator_login` RPC that received the
freshly-bcrypted plaintext password hash and compared
it byte-by-byte to `operators.password_hash`. That is
broken: bcrypt embeds a random salt in every output, so
hashing the same plaintext twice produces two different
hashes. Equality compare fails on every login. The
correct shape is to verify plaintext against the stored
hash in **Node** (`bcrypt.compare(plaintext, storedHash)`)
and only call SQL once auth has succeeded. The RPC
must NEVER receive a plaintext password OR a freshly-
hashed proof — the SQL boundary works on the verified
`operator_id`, not on credential material.

The login flow is therefore SPLIT into two RPCs +
Node-side bcrypt comparison in between.

##### Step 1 — `operator_login_lookup(p_email)`

1. Look up the operator by normalized `auth_email`
   (Codex round-2 P1 #1: NOT `contact_email`, which is
   profile-mutable). If not found → return
   `{ ok: false, error: 'invalid_credentials' }`
   (do NOT distinguish unknown-email from wrong-password
   — leaking that lets a spammer enumerate signups).
2. If `signup_status != 'approved'` → return the
   appropriate structured error: `'pending'` →
   `signup_pending`, `'rejected'` → `signup_rejected`,
   `'suspended'` → `account_suspended`.
3. Return `{ ok: true, operator_id, password_hash,
   password_must_change }`. The Server Action receives
   the stored bcrypt hash (60-char string) and runs
   `bcrypt.compare(plaintext, storedHash)` in Node.

Note: returning the stored hash to the Server Action is
NOT a leak — the Server Action runs server-side under
service-role; the hash never reaches the browser. The
plaintext password the user submitted is also Node-only;
it is never sent to SQL.

##### Step 2 — Server Action runs bcrypt.compare(plaintext, storedHash) in Node

If the comparison returns `false`, the Server Action
returns `{ ok: false, error: 'invalid_credentials' }`
with the same opaque shape as a missing-email response.
The caller cannot distinguish wrong-password from
unknown-email.

If the comparison returns `true`, the Server Action
proceeds to step 3.

##### Step 3 — `operator_login_create_session(p_operator_id, p_session_token_hash, p_remember_me, p_ip, p_user_agent)`

1. Lock the operator row. Re-validate
   `signup_status='approved'` (defense in depth: the
   operator may have been suspended in the few
   milliseconds between step 1 and step 3).
2. INSERT into `operator_sessions` with the hash + the
   computed `expires_at` (7 days default; 30 days if
   `p_remember_me=true`) + IP + user agent.
3. UPDATE `operators.last_login_at = NOW()`.
4. Return `{ ok: true, session_token_hash, expires_at,
   password_must_change }`.

The Server Action mints the raw session token
(`randomBytes(32).toString('base64url')`), hashes it
with sha256 to produce `p_session_token_hash`, and sets
the `aeris_operator` cookie to the raw token. The DB
only ever sees the hash.

#### `operator_session_validate`

1. SELECT FROM `operator_sessions` WHERE
   `token_hash = p_token_hash` AND `revoked_at IS NULL`
   AND `expires_at > NOW()`.
2. If no row → return `{ ok: false, error: 'invalid_session' }`.
3. SELECT the operator + `signup_status`. If
   `signup_status != 'approved'` → return
   `{ ok: false, error: 'account_not_approved' }` (an
   operator approved-then-suspended sees this).
4. Return `{ ok: true, operator_id, expires_at,
   password_must_change }`.

The Server Action calls this on every protected request.
For high-traffic surfaces (the legs list page) the
session is revalidated only on cold render; client-side
prefetched paths re-use the cookie.

#### `admin_approve_operator`

1. Lock the row. Reject `signup_status != 'pending'`
   → `not_pending`.
2. UPDATE `signup_status='approved', approved_at=NOW(),
   approved_by_admin_at=NOW(),
   welcome_token_hash=<from caller>,
   welcome_token_expires_at=NOW() + INTERVAL '7 days'`.
3. Return `{ ok: true, operator_id }`.

The welcome token is minted by the admin Server Action
(separate HMAC secret — same shape as Phase 7's
operator-session-token, different secret). The Server
Action then triggers a Resend email containing the
welcome URL.

#### `admin_reject_operator`

1. Lock the row. Reject `signup_status != 'pending'`
   → `not_pending`.
2. UPDATE `signup_status='rejected', rejected_at=NOW(),
   rejection_reason=p_reason`.
3. Return `{ ok: true, operator_id }`.

The Server Action sends a Resend rejection email with the
reason.

#### `admin_suspend_operator`

1. Lock the row. Reject `signup_status NOT IN ('approved')`
   → `not_approved`.
2. UPDATE `signup_status='suspended', suspended_at=NOW(),
   suspension_reason=p_reason`.
3. SET every active `operator_sessions` row's `revoked_at
   = NOW()`. The operator is forced out of the portal.
4. Return `{ ok: true, operator_id, sessions_revoked }`.

#### `admin_unsuspend_operator`

1. Lock the row. Reject `signup_status != 'suspended'` →
   `not_suspended`.
2. UPDATE `signup_status='approved', suspended_at=NULL,
   suspension_reason=NULL`.
3. Active sessions stay revoked (the operator must
   re-login). Return `{ ok: true, operator_id }`.

#### `admin_set_operator_documents`

1. Lock the row. Reject `signup_status NOT IN
   ('pending','approved')` → `not_writable`.
2. UPDATE `commercial_registration, gaca_license,
   license_expiry` from the parameters. NULL parameters
   leave the existing column value (so admin can update
   one document at a time).
3. Return `{ ok: true, operator_id }`.

The function does NOT touch `operator_documents` rows —
those are managed by a separate Server Action that
moves files in/out of Supabase Storage. This RPC just
sets the regulatory text fields.

#### `admin_reset_operator_password`

1. Lock the row. Reject `signup_status NOT IN ('approved','suspended')`
   → `not_resettable`.
2. UPDATE `password_hash = p_new_password_hash,
   password_set_at = NOW(), password_must_change = TRUE`.
3. Revoke every active session (forces re-login).
4. Return `{ ok: true, operator_id }`.

#### `mint_operator_password_reset_token`

1. Look up the operator by normalized `auth_email`
   (Codex round-2 P1 #1: NOT `contact_email`). If not
   found → return `{ ok: true, no_op: true }` (do NOT
   leak that the email isn't registered — same posture
   as `operator_login`).
2. INSERT into `operator_password_reset_tokens` with the
   hash, expires_at = NOW() + INTERVAL '30 minutes',
   ip_address from the caller.
3. Return `{ ok: true, token_id }`.

The Server Action sends the email AFTER this RPC
returns; the email body contains the raw token in the
URL. The DB never sees the raw token.

#### `verify_operator_password_reset`

1. Look up the token by hash. Reject `used_at IS NOT
   NULL` → `token_already_used`. Reject `expires_at <=
   NOW()` → `token_expired`.
2. UPDATE `operators.password_hash = p_new_password_hash,
   password_set_at = NOW(), password_must_change = FALSE`.
3. UPDATE `operator_password_reset_tokens.used_at =
   NOW()`.
4. Revoke every active session for the operator.
5. Return `{ ok: true, operator_id }`.

#### `mint_operator_otp` + `verify_operator_otp`

The OTP RPCs mirror the password-reset shape but with a
6-digit code instead of a long token, a 10-min TTL, and
an attempt-count limit (`>= 5` → reject).

#### `consume_operator_welcome_token`

The welcome token is special: it bypasses password
verification and creates a fresh session for the
operator. Used once on first login.

1. Look up `operators` by `welcome_token_hash =
   p_token_hash`.
2. Reject `welcome_token_used_at IS NOT NULL` →
   `already_used`. Reject `welcome_token_expires_at <=
   NOW()` → `expired`.
3. Reject `signup_status != 'approved'` →
   `account_not_approved`.
4. INSERT a fresh `operator_sessions` row (the Server
   Action mints the session token; same flow as
   `operator_login`).
5. UPDATE `welcome_token_used_at = NOW(),
   last_login_at = NOW(),
   password_must_change = (password_hash IS NULL)`.
   The `password_must_change` heuristic is: if the
   operator never set a password during signup (rare
   path — admin-created accounts), they MUST set one on
   first login.
6. Return `{ ok: true, operator_id, session_token_hash,
   expires_at, password_must_change }`.

#### `convert_phase7_stub_to_operator`

1. Lock both rows: stub + operator.
2. Reject if either doesn't exist (`stub_not_found` /
   `operator_not_found`).
3. Reject if `phase7_operator_stubs.status = 'archived'`
   → `stub_already_archived`.
4. Reject if the operator's
   `signup_status NOT IN ('approved','suspended')` →
   `operator_not_writable`.
5. UPDATE every `empty_legs` row WHERE `operator_stub_id
   = p_stub_id`: SET `operator_id = p_operator_id,
   operator_stub_id = NULL`.
6. UPDATE the stub: SET `status = 'archived'`.
7. Return `{ ok: true, stub_id, operator_id, legs_reassigned }`.

### Files in PR 2a

- **Add:** `supabase/migrations/20260513000021_phase_8_operator_rpcs.sql`
- **Edit:** `types/database.ts` — Args + Result types for
  **all 17 publics** enumerated in §4.1 (Codex round-3
  P2 #1 fix: count updated from 15 to 17 after the
  round-2 login split + welcome-token reclassification).
  Each function gets its `Args*` + `Result*` exports +
  one entry in `Database['public']['Functions']`. The
  helper `_normalize_operator_email` is intentionally
  NOT exposed in the Functions map (REVOKEd from every
  role; callable only from inside the publics).
- **Edit:** `lib/empty-legs/types.ts` — re-export the
  Phase-8-scoped surface (17 Args/Result type pairs;
  helper not exposed; mirrors PR 2a discipline).

### Founder probes after PR 2a (4 probes)

5. **RPC grants** (Codex round-2 P1 #2 fix: count
   updated to 17 publics + 1 helper after the login
   split + the welcome-token reclassification) —
   service-role psql: `\df+ public.*operator*` shows
   17 publics:
     1. `operator_signup`
     2. `operator_login_lookup`
     3. `operator_login_create_session`
     4. `operator_logout`
     5. `operator_session_validate`
     6. `admin_approve_operator`
     7. `admin_reject_operator`
     8. `admin_suspend_operator`
     9. `admin_unsuspend_operator`
     10. `admin_set_operator_documents`
     11. `admin_reset_operator_password`
     12. `mint_operator_password_reset_token`
     13. `verify_operator_password_reset`
     14. `mint_operator_otp`
     15. `verify_operator_otp`
     16. `convert_phase7_stub_to_operator`
     17. `consume_operator_welcome_token`
   plus the 1 helper `_normalize_operator_email`. Each
   public has `EXECUTE` granted to `service_role` ONLY.
   Helper has zero grantees.
6. **Approve smoke** — admin RPC dry-run: INSERT a
   pending operator row with **all required fixture
   columns** (Codex round-3 P1 #1 fix: `auth_email` is
   NOT NULL):
   ```sql
   INSERT INTO operators
     (auth_email, contact_email, contact_phone,
      company_name, signup_status,
      password_hash, password_set_at)
   VALUES
     ('probe6@aeris.test', 'probe6@aeris.test',
      '+966500000006', 'Probe 6 Aviation Co',
      'pending',
      '$2a$12$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopq',
      NOW())
   RETURNING id;
   ```
   Then call `admin_approve_operator(<id>,
   <welcome_token_hash>, NOW() + INTERVAL '7 days')`.
   Assert `signup_status='approved'`, `approved_at`
   non-NULL, `welcome_token_hash` matches the input.
   The placeholder `password_hash` above is a
   syntactically-valid bcrypt string (60 chars, $2a$12$
   prefix); Probe 6 doesn't actually log in, so the
   hash plaintext doesn't matter.
7. **Login smoke** (Codex round-2 P1 #2 + round-3 P1 #1
   fixes — probe updated for the 2-step login flow with
   explicit fixture seeding):
   1. INSERT a fresh operator row with `auth_email`,
      `contact_email`, `password_hash` (bcrypted from a
      known plaintext, e.g. `Probe7TestPass!`),
      `signup_status='approved'`. The bcrypt hash MUST
      be generated by Node's `bcryptjs.hashSync('Probe7TestPass!', 12)`
      — NOT a placeholder, because step 3 below
      verifies against this stored hash.
      ```sql
      INSERT INTO operators
        (auth_email, contact_email, contact_phone,
         company_name, signup_status,
         password_hash, password_set_at,
         approved_at, approved_by_admin_at)
      VALUES
        ('probe7@aeris.test', 'probe7@aeris.test',
         '+966500000007', 'Probe 7 Aviation Co',
         'approved',
         '<bcrypt-of-Probe7TestPass-from-Node>', NOW(),
         NOW(), NOW())
      RETURNING id;
      ```
   2. Call `operator_login_lookup('probe7@aeris.test')` →
      assert `{ ok: true, operator_id, password_hash, password_must_change }`.
   3. In Node, run
      `bcryptjs.compareSync('Probe7TestPass!', password_hash)`
      → assert `true`.
   4. Call `operator_login_create_session(operator_id,
      <sha256(raw_session_token)>, false, '127.0.0.1', 'probe')`
      → assert a session row appears in
      `operator_sessions` with the right `expires_at`
      (NOW + 7 days for `remember_me=false`).
   5. Call `operator_session_validate(<sha256(raw_session_token)>)` →
      returns `{ ok: true, operator_id }`.
8. **Stub conversion smoke** — INSERT a synthetic stub +
   operator + 2 empty_legs rows linked to the stub.
   Call `convert_phase7_stub_to_operator(stub_id,
   operator_id)`. Assert: stub.status='archived', both
   legs have `operator_id=...` and `operator_stub_id=NULL`.

---

## 5. PR 2b — Admin surfaces

UI + 9 admin Server Actions. Mirrors the Phase 7 PR 2b
admin-shell + admin-protected route discipline.

### Files (Add)

- `app/(admin)/admin/(protected)/operators/page.tsx` —
  list + status filter chips (default: pending +
  approved). Filter chips: pending (count), approved
  (count), suspended (count), rejected (count), all.
- `app/(admin)/admin/(protected)/operators/[id]/page.tsx`
  — operator detail with 4-case admin gate:
    - **Case 1 — pending:** approve form + reject form.
    - **Case 2 — approved:** suspend form + reset-
      password form + mint-otp form + edit-documents
      form + convert-stub form (lists active stubs).
    - **Case 3 — suspended:** unsuspend button +
      reset-password form + suspension reason readonly.
    - **Case 4 — rejected:** rejection reason readonly +
      "re-open as pending" button (admin override).
- `app/(admin)/admin/(protected)/operators/[id]/documents/page.tsx`
  — upload UI (Supabase Storage bucket
  `operator-documents`) + list of uploaded files (read-
  only metadata + signed URL preview).
- `app/(admin)/admin/(protected)/empty-legs/operators/[stub_id]/convert/page.tsx`
  — stub conversion form (Decision §4): pick or create
  target operator + preview the legs that will be
  reassigned + confirm button.
- `components/admin/operators/list-filters.tsx`
- `components/admin/operators/operator-row.tsx`
- `components/admin/operators/operator-detail-pending.tsx`
- `components/admin/operators/operator-detail-approved.tsx`
- `components/admin/operators/operator-detail-suspended.tsx`
- `components/admin/operators/operator-detail-rejected.tsx`
- `components/admin/operators/document-upload-form.tsx`
- `components/admin/operators/document-list.tsx`
- `components/admin/operators/stub-convert-form.tsx`
- `components/admin/operators/status-badge.tsx`
- `app/actions/operators.ts` — 9 admin Server Actions:
  `adminApproveOperator`, `adminRejectOperator`,
  `adminSuspendOperator`, `adminUnsuspendOperator`,
  `adminSetOperatorDocuments`, `adminResetOperatorPassword`,
  `adminMintOperatorOtp`, `adminUploadOperatorDocument`
  (Supabase Storage upload), `adminConvertPhase7Stub`.
- `lib/admin/operators/queries.ts` — read queries:
  `listOperators`, `countOperatorsByStatus`,
  `getOperatorById`, `listOperatorDocuments`,
  `listActiveStubsForConversion`.
- `lib/operators/welcome-token.ts` — HMAC mint +
  verify for the admin-approval welcome link. 7-day
  TTL. Separate secret `OPERATOR_WELCOME_TOKEN_SECRET`.
- `lib/i18n/operators-ar.ts` — every Arabic-RTL string
  per the Phase 7 i18n discipline.
- `lib/validators/operators.ts` — Zod schemas for the 9
  admin actions.

### Files (Edit)

- `components/admin/admin-shell.tsx` — add "المشغّلون"
  nav entry (gated by a new
  `ENABLE_OPERATOR_PORTAL_ADMIN` flag, default `true`).
  Place AFTER "الرحلات الفارغة" + "قائمة المراسلات" +
  "سجلّات المشغّلين" entries; the Phase 7 stub-bootstrap
  page stays accessible for backward compatibility (and
  it's the entry to the convert flow).
- `.env.example` — add `OPERATOR_WELCOME_TOKEN_SECRET`,
  `OPERATOR_PASSWORD_RESET_TOKEN_SECRET`,
  `OPERATOR_OTP_SECRET`, `OPERATOR_SESSION_SECRET` (the
  HMAC secret for the cookie value),
  `ENABLE_OPERATOR_PORTAL_ADMIN`,
  `ENABLE_OPERATOR_LEGACY_TOKEN`.

### Founder probes after PR 2b (5 probes)

9. **Admin operators list** — visit
   `/admin/operators`; verify zero rows; each filter
   chip count is `0`.
10. **Approve flow** — call the signup RPC manually for
    a synthetic operator (the signup form lives in PR
    2c, not 2b — for this probe the founder INSERTs a
    `operators` row directly via psql with
    `signup_status='pending'`). Visit the row's
    `/admin/operators/[id]` page; click "approve". Verify
    `signup_status='approved'` + a welcome token hash
    appears in the row.
11. **Reject flow** — same posture: INSERT another
    `pending` row; reject with reason. Verify
    `signup_status='rejected'` + `rejection_reason`
    matches.
12. **Document upload** — upload a 1-page PDF to the
    Supabase Storage bucket via the admin UI. Verify a
    row appears in `operator_documents` AND the file is
    accessible via signed URL.
13. **Stub conversion** — INSERT a synthetic stub +
    operator + 1 leg linked to the stub via `operator_stub_id`.
    Use the admin UI to convert. Verify the leg's
    `operator_id` is now set, `operator_stub_id=NULL`,
    stub `status='archived'`.

---

## 6. PR 2c — Operator portal (full)

The new front door for every operator. Replaces the
Phase 7 token-URL shape with cookie + session auth.

### Files (Add)

- `app/operator/signup/page.tsx` — public hybrid signup
  (email + password + company_name + contact_email +
  contact_phone + notes textarea). Renders the
  rate-limit warning when the IP is over the threshold.
- `app/operator/login/page.tsx` — email + password +
  "تذكّرني" toggle.
- `app/operator/login/otp/page.tsx` — WhatsApp OTP path
  for recovery (the operator types the 6-digit code that
  admin minted from `/admin/operators/[id]`).
- `app/operator/forgot-password/page.tsx` — email-only
  form to request a reset link.
- `app/operator/reset-password/[token]/page.tsx` —
  token-bound reset form (single-use, 30-min TTL).
- `app/operator/welcome/[token]/page.tsx` — first-login
  welcome page after admin approval. Verifies the
  welcome token + creates a session + redirects to
  `/operator/dashboard`.
- `app/operator/(authed)/layout.tsx` — protected layout.
  Reads the `aeris_operator` cookie, validates via
  `operator_session_validate`, redirects to
  `/operator/login` on failure.
- `app/operator/(authed)/dashboard/page.tsx` — overview
  (active legs count + pending bookings count + recent
  activity).
- `app/operator/(authed)/empty-legs/page.tsx` —
  legs-list page (re-uses Phase 7's
  `EmptyLegsTable` with `getLegHref` set to
  `/operator/empty-legs/<id>`; no token in URL).
- `app/operator/(authed)/empty-legs/new/page.tsx` —
  publish form (re-uses
  `OperatorPublishForm` from Phase 7; the Server Action
  passes the session's `operator_id` instead of the
  Phase 7 `operator_stub_id`).
- `app/operator/(authed)/empty-legs/[id]/page.tsx` —
  detail / edit / cancel (operator-scoped; re-uses
  Phase 7 components).
- `app/operator/(authed)/bookings/page.tsx` —
  read-only confirmed bookings list (Decision §10).
- `app/operator/(authed)/bookings/[id]/page.tsx` — read-
  only booking detail.
- `app/operator/(authed)/profile/page.tsx` — view +
  edit basic info (company_name, contact_email,
  contact_phone). Notes textarea.
- `app/operator/(authed)/profile/documents/page.tsx` —
  read-only document list (commercial_registration,
  gaca_license dates + signed URLs to view PDFs).
- `app/operator/(authed)/profile/password/page.tsx` —
  change password form (current + new + confirm). Hides
  the current-password field when
  `password_must_change=true` (the magic-link first-
  login path).
- `app/operator/(authed)/earnings/page.tsx` — mock data
  + "قريباً" placeholder (Decision §9).
- `app/operator/logout/route.ts` — POST handler that
  revokes the session row + clears the cookie.
- `app/actions/operators-public.ts` — 8 anon-callable
  Server Actions: `operatorSignup`, `operatorLogin`,
  `operatorLogout`, `operatorRequestPasswordReset`,
  `operatorVerifyPasswordReset`, `operatorVerifyOtp`,
  `operatorChangePassword` (authed),
  `operatorUpdateProfile` (authed).
- `lib/operators/auth.ts` — cookie mint + verify
  (mirrors `lib/admin/auth.ts` shape; separate secret
  + cookie name).
- `lib/operators/password.ts` — bcrypt wrappers (cost =
  12). Uses **`bcryptjs`** (pure JS, no native binding;
  Vercel serverless-friendly — Codex round-2 P1 #3
  fix). PR 2c file fence MUST include the
  `package.json` + `package-lock.json` edits adding
  `"bcryptjs": "^2.4.3"` and `"@types/bcryptjs": "^2.4.6"`
  (devDep). The choice of `bcryptjs` over `bcrypt` is
  intentional: `bcrypt` ships native bindings that
  occasionally fail on Vercel cold starts (different
  glibc versions). `bcryptjs` is ~30% slower at
  cost=12 (still <500ms per hash) — acceptable for
  login latency.
- `lib/operators/password-reset-token.ts` — HMAC mint +
  verify; separate secret `OPERATOR_PASSWORD_RESET_TOKEN_SECRET`.
- `lib/operators/session-store.ts` — DB-side helpers
  (insert + lookup-by-hash + revoke + list-active).
- `components/operator/portal-shell.tsx` — auth'd
  layout chrome (logo + nav: dashboard, legs, bookings,
  profile, earnings + logout).
- `components/operator/signup-form.tsx`
- `components/operator/login-form.tsx`
- `components/operator/forgot-password-form.tsx`
- `components/operator/reset-password-form.tsx`
- `components/operator/welcome-handoff.tsx`
- `components/operator/dashboard-cards.tsx`
- `components/operator/booking-row.tsx`
- `components/operator/profile-edit-form.tsx`
- `components/operator/password-change-form.tsx`
- `components/operator/otp-form.tsx`
- `components/operator/earnings-placeholder.tsx`

### Files (Edit)

- `components/admin/empty-legs/leg-row.tsx` — already
  takes `getLegHref` (added in Phase 7); no further
  changes.
- `lib/i18n/operators-ar.ts` (created in PR 2b; PR 2c
  adds portal strings).
- `lib/validators/operators.ts` — add the 8 public
  Server Action schemas.
- `package.json` — Codex round-2 P1 #3 fix. Add
  `"bcryptjs": "^2.4.3"` to `dependencies` and
  `"@types/bcryptjs": "^2.4.6"` to `devDependencies`.
  Without this, `lib/operators/password.ts` does not
  compile — `bcryptjs` is not in the current
  package.json (verified against the `6468dfb` main
  state).
- `package-lock.json` — committed alongside `package.json`
  to lock the resolved version tree (mirrors Phase 6.2
  / Phase 7's discipline of committing the lockfile in
  the same PR as the dependency add).
- `app/actions/operator-empty-legs.ts` (Phase 7 file) —
  conditional: if the Phase 7 token-URL flow is on
  (`ENABLE_OPERATOR_LEGACY_TOKEN=true`), the existing
  Server Actions stay accessible. PR 2c does NOT delete
  them. The new `/operator/(authed)/...` Server Actions
  are added in `app/actions/operators-empty-legs-authed.ts`
  with the same RPC bindings but session-based instead
  of token-based.
- `.env.example` — already has the secrets from PR 2b.

### Founder probes after PR 2c (6 probes)

14. **Self-signup** — submit the public signup form with
    valid data. Verify a `pending` operator row appears.
15. **Rate limit** — submit the form 4 times from the
    same IP within 24h with different emails. Verify the
    4th submission is rejected with `rate_limited`. (For
    smoke, the 24h window can be reduced via a hidden
    test override, or the founder can verify the cap
    logic via a SQL query against
    `operator_signup_attempts`.)
16. **Login + dashboard** — admin approves the operator;
    operator clicks the welcome link in email; lands on
    dashboard. Cookie is set. Refresh page → still
    authenticated.
17. **Legs publish via session** — operator publishes a
    leg via `/operator/(authed)/empty-legs/new`. Verify
    `empty_legs.operator_id` is the session's operator
    (not `operator_stub_id`).
18. **Forgot password** — operator opens
    `/operator/forgot-password`, types email, gets reset
    link via Resend. Click link → land on reset form.
    Set new password. Verify old session is revoked +
    new password works.
19. **WhatsApp OTP** — admin mints OTP from
    `/admin/operators/[id]`, copies the 6-digit code (the
    admin UI displays the plaintext once). Operator
    types it at `/operator/login/otp` → lands on
    dashboard.

---

## 7. PR 2d — Recovery flow notifications (Resend + WhatsApp)

PR 2d wires the email + WhatsApp messaging that PR 2b/2c
trigger. Mirrors Phase 7 PR 2e's
`lib/empty-legs/notifications.ts` discipline.

### Files (Add)

- `lib/operators/notifications.ts` — single entrypoint
  with 5 functions: `sendOperatorWelcomeEmail`,
  `sendOperatorRejectionEmail`,
  `sendOperatorSuspensionEmail`,
  `sendOperatorPasswordResetEmail`,
  `sendOperatorOtpWhatsAppMessage`.
- `lib/operators/notification-templates/operator-welcome-email.ts`
  — Resend HTML, branded (re-uses
  `lib/notifications/lead-email.ts` brand template).
  Body includes the welcome magic link + "go to portal"
  button.
- `lib/operators/notification-templates/operator-rejection-email.ts`
- `lib/operators/notification-templates/operator-suspension-email.ts`
- `lib/operators/notification-templates/operator-password-reset-email.ts`
- `lib/operators/notification-templates/operator-otp-whatsapp.ts`
  — text-only template for wa.me prefilled message
  (admin copy-pastes from
  `/admin/operators/[id]`'s OTP-display section).

### Files (Edit)

- `app/actions/operators.ts` (PR 2b) — every admin
  action that triggers an email now imports the
  notification entrypoint after the RPC succeeds. Same
  fail-tolerant posture: notification failure does NOT
  roll back the RPC.
- `app/actions/operators-public.ts` (PR 2c) —
  `operatorRequestPasswordReset` triggers the email.

### Visible degraded state

Same shape as Phase 7 §founder-batch-email: a singleton
table `operator_notification_alert_status` (id=1) is
UPDATEd on every send attempt with `status ∈ ('healthy',
'config_missing', 'send_failed')`. The
`/admin/operators` list page surfaces a red banner when
status `<> 'healthy'`. PR 2b adds the banner; PR 2d
ensures the singleton is INSERTed by the migration in
PR 1 (mirrors the
`empty_leg_outreach_alert_status` pattern).

### Founder probes after PR 2d (3 probes)

20. **Welcome email delivery** — admin approves an
    operator. Verify a Resend email lands in the
    operator's inbox within 1 minute. Click the magic
    link → operator is logged in.
21. **Password-reset email delivery** — operator
    requests reset. Verify Resend email lands. Click
    link → land on reset form.
22. **Visible degraded state** — break the Resend
    config (set `RESEND_API_KEY=`, redeploy). Approve
    another operator. Verify the admin banner shows
    `status='config_missing'`. Restore the key, redeploy
    → banner disappears on next approval.

---

## 8. PR 2e — Stub conversion + cron + retire-legacy flag

PR 2e is the final application PR. It ships the
operational tooling that retires the Phase 7 token-URL
flow once the canary window confirms the new portal is
production-ready.

### Files (Add)

- `app/api/cron/operators/cleanup-expired-sessions/route.ts`
  — hourly cron. DELETEs `operator_sessions` rows where
  `revoked_at IS NULL AND expires_at < NOW() - INTERVAL '7 days'`.
  Bounded batch limit (500). Same Bearer
  CRON_SECRET auth as Phase 7.
- `app/api/cron/operators/cleanup-expired-tokens/route.ts`
  — daily cron. DELETEs `operator_password_reset_tokens`
  + `operator_otp_codes` rows where `used_at IS NOT NULL
  OR expires_at < NOW() - INTERVAL '30 days'`. Keeps the
  audit footprint manageable.
- `app/(admin)/admin/(protected)/operators/canary-status/page.tsx`
  — admin readout of the canary state: count of stubs
  pending conversion, count of legacy URL-token
  operators (zero after retirement), per-operator portal
  activity (last login, sessions count). Updates on
  every render (no cache).
- `lib/operators/__tests__/auth.test.ts` — Layer-1 unit
  test for the cookie mint + verify helpers
  (signature/payload tamper, expiry, missing secret
  guards). Mirrors the Phase 7 token-test pattern.
- `lib/operators/__tests__/password.test.ts` — bcrypt
  wrappers smoke (cost 12, hash uniqueness, verify
  contract).

### Files (Edit)

- `vercel.json` — add the 2 new cron entries
  (`*/60 * * * *` for sessions cleanup, `0 4 * * *` for
  tokens cleanup, both UTC).
- `package.json` — add `test:operator-auth` +
  `test:operator-password` script entries.
- `.github/workflows/ci.yml` — add the 2 new test
  steps.
- `lib/admin/empty-legs/queries.ts` (Phase 7 file) —
  `listActiveStubsForConversion` is added by PR 2b but
  PR 2e tightens: stubs become candidates for
  archival-without-conversion if NO `empty_legs` row
  references them AND `created_at < NOW() - INTERVAL '30 days'`.
  The admin canary page shows that count + a "archive
  abandoned stubs" admin action.

### Retire-legacy plan (operational, not code)

Once the founder is satisfied:

1. Manual smoke: every active operator logs into the new
   portal at least once.
2. Run the canary readout query:
   `SELECT COUNT(*) FROM operator_empty_leg_sessions
   WHERE expires_at > NOW() AND revoked_at IS NULL`.
   Wait for it to drop to zero (operators stop using the
   token URLs).
3. Flip `ENABLE_OPERATOR_LEGACY_TOKEN=false` on
   production.
4. Verify the Phase 7 `/operator/empty-legs/<token>`
   path returns 404 (or 410 Gone if Codex prefers).
5. Optionally: purge `operator_empty_leg_sessions` rows
   in a follow-up migration (Phase 8.1 territory; not
   shipped here).

### Founder probes after PR 2e (4 probes)

23. **Cron auth** — both new cron routes return 401
    without `$CRON_SECRET`, 200 with.
24. **Session cleanup smoke** — INSERT a synthetic
    expired session row. Wait for the cron tick (or
    manually trigger). Verify the row is DELETEd.
25. **Token cleanup smoke** — same shape for
    `operator_password_reset_tokens`.
26. **Canary readout accuracy** — visit
    `/admin/operators/canary-status`. Verify the counts
    match SQL queries the founder runs side-by-side.

---

## 9. Out of scope (explicit)

Phase 8 does NOT ship any of:

- **Real earnings calculation** — Phase 11 territory.
  Earnings page is a "قريباً" placeholder.
- **Booking actions for operators** — operators see
  bookings read-only. Cancel / accept / reschedule are
  admin-only, period.
- **Multi-tenant ops** — one operator account = one
  organization. Sub-users / role-based access inside an
  operator account are Phase 9+ if they ever ship.
- **Native mobile app** — the portal is responsive web
  only. PWA install prompts are out of scope.
- **OAuth / SSO** — custom + bcrypt only. Google /
  Apple / Microsoft sign-in are Phase 9+ if they ever
  ship.
- **2FA TOTP** — WhatsApp OTP is the only second
  factor. Authenticator-app TOTP is Phase 9+.
- **Document expiry alerts** — when `gaca_license`'s
  `license_expiry` approaches, no automatic email is
  sent. Admin watches manually. Phase 8.1 territory.
- **Operator-side support tickets** — `/operator/support`
  is NOT shipped. Operators contact admin via WhatsApp.
- **Stripe / Hyperpay onboarding** for operators —
  payout configuration is Phase 11 alongside the wider
  payment infrastructure.
- **Operator account deletion** — admin can `suspend`
  but not `delete`. Hard delete + GDPR-compliant data
  purge is Phase 9+ (PDPL has the same posture).
- **Audit log surface** — the `audit_logs` table is
  populated but there is no admin UI to browse it.
  Phase 8.1 / 9.

---

## 10. Acceptance criteria

Phase 8 is acceptable only if every numbered item below is
demonstrably true on production immediately after PR 2e
merges.

### Schema (PR 1)

1. `operators.user_id` is nullable.
2. `operators.commercial_registration`, `gaca_license`,
   `license_expiry` are all nullable.
3. `operators` has the 14 new columns from §3.3
   (including the round-2 `auth_email` column with
   the round-3 NOT NULL invariant — Codex round-4
   P2 #1 follow-on: §10 acceptance row 3 was also
   stale at 13).
4. `operators.signup_status` exists (renamed from
   `status`) with the 4-value CHECK.
5. The 6 new tables (`operator_sessions`,
   `operator_password_reset_tokens`, `operator_otp_codes`,
   `operator_documents`, `operator_signup_attempts`,
   `operator_notification_alert_status`) all exist with
   their indexes + RLS-enabled. The
   `operator_notification_alert_status` singleton row
   (`id=1, status='healthy'`) is seeded by the migration
   (Codex round-1 P1 #3 fix).
6. The audit trigger `operators_audit_trigger` fires
   on `signup_status` change AND on `password_hash`
   change.

### RPCs (PR 2a)

7. 17 public functions + 1 helper exist; all are
   SECURITY DEFINER (Codex round-2 P1 #2 fix: count
   updated after login split + welcome-token
   reclassification).
8. Each public has `EXECUTE` granted to `service_role`
   ONLY.
9. The helper `_normalize_operator_email` has zero
   grantees.
10. `operator_signup` rejects duplicate emails AND
    rate-limited IPs (≥3 successful signups in 24h).
11. The login flow rejects unknown email + wrong
    password with the same opaque error
    (`invalid_credentials`). The 2-step contract
    (Codex round-2 P1 #2 fix): `operator_login_lookup`
    returns `invalid_credentials` for unknown email AND
    the Server Action returns the same error after a
    failed `bcrypt.compare()`. The two paths are
    indistinguishable to the caller.
12. `operator_session_validate` rejects expired
    sessions, revoked sessions, and sessions whose
    operator was suspended after the session was minted.
13. `admin_approve_operator` flips status + mints a
    welcome token + emits the audit-log row.
14. `admin_suspend_operator` flips status + revokes
    every active session in one transaction.
15. `convert_phase7_stub_to_operator` reassigns every
    leg AND archives the stub atomically.

### Admin surfaces (PR 2b)

16. `/admin/operators` lists all operators with
    status-filter chips.
17. `/admin/operators/[id]` shows the right Case (1-4)
    based on `signup_status`.
18. Admin can approve / reject / suspend / unsuspend
    from the detail page.
19. Admin can upload PDF/JPG documents (≤10 MB) to
    Supabase Storage; the file appears in
    `operator_documents` AND signed URLs render.
20. Admin can mint a 6-digit OTP from
    `/admin/operators/[id]`; the plaintext displays
    once.
21. Admin can convert a Phase 7 stub from
    `/admin/empty-legs/operators/[stub_id]/convert`;
    the stub flips to archived AND every leg's
    `operator_id` is set.

### Operator portal (PR 2c)

22. `/operator/signup` accepts valid signups.
23. `/operator/login` rejects unapproved /
    rejected / suspended operators with distinct
    structured errors.
24. `/operator/dashboard` is reachable only with a
    valid session cookie.
25. `/operator/empty-legs/new` publishes a leg whose
    `operator_id` is the session's operator (NOT a
    `operator_stub_id`).
26. `/operator/forgot-password` accepts an email
    (returns success even if the email isn't
    registered).
27. `/operator/reset-password/[token]` rejects expired
    or used tokens.
28. `/operator/welcome/[token]` creates a session +
    redirects to dashboard.
29. The "تذكّرني" toggle on login extends session
    expiry to 30 days (verified by inspecting the
    session row).

### Recovery flow (PR 2d)

30. Welcome email lands in the operator's inbox within
    1 minute of admin approval.
31. Password-reset email contains the raw token in the
    URL; the DB only stores the hash.
32. The admin OTP-mint page displays the plaintext
    code once; the DB only stores the hash.
33. WhatsApp OTP message is rendered via wa.me link
    (admin copies the URL, sends via WhatsApp Business).
34. The `operator_notification_alert_status` singleton
    is UPDATEd on every email send attempt.

### Cleanup + canary (PR 2e)

35. Both cron routes register on Vercel + execute on
    schedule.
36. Expired session rows are DELETEd within 1 hour of
    expiry-plus-7-days.
37. Used password-reset / OTP rows are DELETEd within
    24 hours.
38. The canary status page accurately reflects the
    state of the Phase 7→Phase 8 migration.

---

## 11. Founder probes (consolidated)

27 individual probe checks across the 5 PRs. The spec
defines probes 1-26 (Phase 7 numbering convention) plus
**probe 4a** (alert-status singleton seed, added in
round 1 per P1 #3 + P2 #1 fixes). The earlier round-0
draft listed 26 individual probes; round 1 added one
(4a) bringing the total to 27 individual checks.

(Full probe text lives in §3-§8 above; this is the
index.)

| # | Probe | After PR |
|:-:|---|---|
| 1 | Schema state — operators columns | 1 |
| 2 | 6 new tables + RLS | 1 |
| 3 | Audit trigger smoke | 1 |
| 4 | (Round-0 draft had a "Document storage policy" entry here. Codex round-1 P2 #1 retargeted it: storage-bucket creation is operational, not migration-bound; this slot is now retired. The audit-trigger smoke is probe 3.) | — |
| 4a | Alert-status singleton seed (Codex round-1 P1 #3 + P2 #1 fix) | 1 |
| 5 | RPC grants | 2a |
| 6 | Approve smoke | 2a |
| 7 | Login smoke | 2a |
| 8 | Stub conversion smoke | 2a |
| 9 | Admin operators list | 2b |
| 10 | Approve flow | 2b |
| 11 | Reject flow | 2b |
| 12 | Document upload | 2b |
| 13 | Stub conversion (UI) | 2b |
| 14 | Self-signup | 2c |
| 15 | Rate limit | 2c |
| 16 | Login + dashboard | 2c |
| 17 | Legs publish via session | 2c |
| 18 | Forgot password | 2c |
| 19 | WhatsApp OTP | 2c |
| 20 | Welcome email delivery | 2d |
| 21 | Password-reset email delivery | 2d |
| 22 | Visible degraded state | 2d |
| 23 | Cron auth | 2e |
| 24 | Session cleanup smoke | 2e |
| 25 | Token cleanup smoke | 2e |
| 26 | Canary readout accuracy | 2e |

---

## 12. Risks + mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|:-:|---|---|---|---|
| R1 | Operator signup spam — bots create thousands of pending rows | Medium | Medium (admin queue noise) | Per-IP rate limit (Decision §12). Failed attempts also INSERT into `operator_signup_attempts` so the founder can audit IPs. |
| R2 | Bcrypt cost too high → slow login | Low | Low | Cost = 12 (industry standard). Login latency stays <500ms on typical Vercel cold starts. |
| R3 | Welcome token leaks in logs / email forwarding | Low | High (account takeover) | Token is single-use — `welcome_token_used_at IS NOT NULL` guard. Token expires 7 days. |
| R4 | Session token exfil → impersonation | Low | High | Cookie is HttpOnly + Secure + SameSite=Lax. Token hash stored DB-side; even DB dump can't reverse to raw cookie. Admin can revoke from `/admin/operators/[id]` (suspend revokes all sessions). |
| R5 | Stub conversion data loss — legs lose their stub linkage and gain an invalid operator_id | Medium | High | Conversion RPC is single-transaction. Lock both rows. Reject if either doesn't exist. Validate target operator's `signup_status NOT IN ('rejected')` before reassigning. |
| R6 | Document upload abuse — 10 MB × 1000 ops = 10 GB Supabase Storage | Low | Low (cost) | Per-operator-document unique index limits to one doc per type (3 max). Total worst-case: 3 × 10 MB × N operators. Phase 1 Aeris targets 50 operators in year 1; storage cost negligible. |
| R7 | RLS misconfiguration leaks operator emails to anon | Low | High (privacy) | Every new table has RLS enabled + zero policies (service-role only). Founder probe verifies. |
| R8 | Phase 7 legacy token URLs continue working forever (forgotten) | Medium | Low (surface clutter) | The retire-legacy plan in §8 is documented + the canary readout page shows the legacy session count. |
| R9 | Admin reset password leaks new password in logs | Low | High | Admin reset endpoint logs the operator id only, never the password. The new password is shown to admin once on the success page (so admin can communicate it via wa.me) AND included in the email to the operator. Admin must change it on next login (`password_must_change=true`). |
| R10 | OTP brute force — attacker tries all 1M codes | Low | Medium | `attempt_count >= 5` rejects + the row is locked. The combinatorial difficulty is 1/200 000 per attempt with the 5-attempt cap. |
| R11 | Audit trigger writes to a wrong audit_logs shape and breaks INSERTs | Low | Medium | The trigger uses `entity_type, entity_id, action, old_value, new_value` — the verified Phase 6.2 shape. Smoke probe 3 covers. |
| R12 | Hybrid signup means an operator can claim "approved" via tampering | Very low | High | The signup RPC server-sets `signup_status='pending'`. Even if the Server Action ships extra fields, the RPC ignores them. |

---

## 13. Open questions (to be resolved before PR 1 ships)

1. **Welcome email magic link vs plain "click here to set
   password"** — currently §0 step 2 says the welcome
   email contains a magic link. Codex may push back: a
   magic link replaces password entirely on first login,
   which is convenient but means an attacker who
   intercepts the email gets a session. Alternative:
   the email contains a "set your password" URL that
   forces the operator to type a password, then logs in.
   Default: ship the magic link as designed. If Codex
   pushes back, we ship the set-password variant
   (one-line change in the welcome page).

2. **Bcrypt vs Argon2id** — bcrypt is the industry
   default for backend session auth in 2024. Argon2id
   is the OWASP modern recommendation. The migration
   path bcrypt → Argon2id is non-trivial (re-hash on
   every login). Default: ship bcrypt cost=12. Argon2id
   migration is a Phase 8.x or Phase 9 question.

3. **Per-IP rate limit on login (not just signup)** —
   §12 only rate-limits signup. Login can be brute-
   forced if the attacker has a valid email. Default:
   Phase 8 ships login as-is (bcrypt cost=12 makes
   brute force economically uninteresting at low
   volume). A per-IP login rate limit is a Phase 8.1
   add-on.

4. **Email change flow** — RESOLVED in round 2 per Codex
   round-2 P1 #1, with prose corrected in round 5 per
   Codex round-5 P2: `auth_email` is a real column in
   PR 1 §3.3 (added in round 2, NOT NULL in round 3).
   The signup form passes `auth_email` and
   `contact_email` as separate parameters to
   `operator_signup` and MAY seed them with different
   values: `auth_email` is the immutable login
   identity, `contact_email` is the mutable
   operational contact. Profile edits change
   `contact_email` only; `auth_email` is immutable
   post-signup (admin can override via the admin
   reset flow if a real email-change request lands).
   Login + password-reset look up by `auth_email`;
   the duplicate-email check in `operator_signup` is
   also against `auth_email`.

---

## 14. Implementation order

1. **PR 1 — Schema** (no application code; column adds +
   table creates + audit trigger). Founder runs
   migration on production; verifies probes 1, 2, 3,
   4, and 4a (Codex round-4 P2 #2 fix: probe 4a was
   added in round 1 to cover the alert-status
   singleton seed but the handoff checklist still
   said 1-4).
2. **PR 2a — RPC layer** (**17 publics + 1 helper**, all
   SECURITY DEFINER — Codex round-3 P2 #2 fix: count
   updated from 15 to 17 to match §4.1 inventory after
   the round-2 login split + welcome-token
   reclassification). Founder runs migration; verifies
   probes 5-8.
3. **PR 2b — Admin surfaces**. Founder verifies probes
   9-13.
4. **PR 2c — Operator portal**. Founder verifies probes
   14-19.
5. **PR 2d — Notifications** (Resend + WhatsApp wiring).
   Founder verifies probes 20-22.
6. **PR 2e — Cron + canary readout**. Founder verifies
   probes 23-26. Phase 8 is closed.

After Phase 8 closure, the canary window begins. The
retire-legacy plan in §8 is operational, not Phase-8
PR-bound.

---

**End of Phase 8 spec.** Codex reviews this document
before any code is written. Iteration history below.

---

## Codex iteration 1 — findings (resolved in iteration 2)

| # | Finding | Resolution |
|:-:|---|---|
| P1 #1 | "Spec reverses the agreed auth provider — we settled on Supabase Auth" | Recorded as a Codex-vs-founder mismatch: the founder's confirmed pre-spec choice is **Custom + bcrypt** (option ج in the 3-way decision thread). §1 row 1 reworded to call out the founder confirmation explicitly + the Codex round-1 audit annotation. No architecture change. |
| P1 #2 | "Bcrypt login flow cannot work by hashing plaintext again" | Real bug. `operator_login` was redesigned as a 2-step flow: `operator_login_lookup(email)` returns the stored hash + status; the Server Action runs `bcrypt.compare(plaintext, storedHash)` in Node; on success it calls `operator_login_create_session(operator_id, session_token_hash, ...)`. The RPC boundary now never touches plaintext OR a freshly-hashed proof. §4.1 inventory row 2 updated; §4.2 body rewritten with the round-1 P1 #2 background block. |
| P1 #3 | "Notification alert-status table has no PR1 owner" | Real gap. PR 1 §3.10 added `operator_notification_alert_status` singleton table + seed row + RLS posture. Probe count for PR 1 grew from 4 to 5 (added probe 4a). §5 sanity-check query updated to include the new table + a singleton seed verification. §10 acceptance #5 reworded to mention 6 tables + the seed row. §11 probe index gained probe 4a. |
| P2 #1 | "PR 1 says five new tables but probes reference document storage policy" | Probe slot 4 in the round-0 draft was titled "Document storage policy" but PR 1's body never created the Supabase Storage bucket. Resolution: the storage bucket is operational (admin creates it via Supabase Dashboard before the first document upload — covered in PR 2b's pre-deploy operational checklist), not migration-bound. Probe slot 4 is retired in §11; probe 4a (alert-status seed) replaces the slot's intent. |

## Codex iteration 2 — findings (resolved in iteration 3)

| # | Finding | Resolution |
|:-:|---|---|
| P1 #1 | "Auth email is promised but not owned by schema/login flow" | Real gap — round 1's resolution to open-question §13.4 promised an `auth_email TEXT NOT NULL UNIQUE` column without actually adding it. Round 2 added the column to PR 1 §3.3 (nullable + unique partial index on `LOWER(auth_email)`), updated `operator_signup` to seed both `auth_email` AND `contact_email` at signup, and rewrote `operator_login_lookup` + `mint_operator_password_reset_token` to look up by `auth_email`. Open question §13.4 marked RESOLVED. |
| P1 #2 | "Login split leaves function counts and probes stale" | Real cascade. Round 1's `operator_login` → 2-step split was applied to §4.2 but not to §4.1 inventory count, §10 acceptance #7 + #11, or §11 Founder Probe 5/7. Round 2 reworked §4.1 to enumerate each function on its own row (16 publics + the previously-mislabeled `consume_operator_welcome_token` reclassified from "stub" to public #17 = **17 publics + 1 helper**), §10 acceptance #7 + #11 updated, §11 Probe 5 enumerates all 17 by name, §11 Probe 7 walks the 2-step contract step-by-step. |
| P1 #3 | "Bcrypt dependency has no PR owner" | Real gap. Round 1's `lib/operators/password.ts` reference assumed `bcryptjs` was available but the current `package.json` (verified against `6468dfb` main) has no bcrypt-family dependency. Round 2 added `package.json` + `package-lock.json` to PR 2c's "Files (Edit)" with `"bcryptjs": "^2.4.3"` + `"@types/bcryptjs": "^2.4.6"`. The choice of `bcryptjs` over `bcrypt` is intentional (pure JS, Vercel cold-start safe). |
| P2 #1 | "PR 1 types bullet still says five tables" | After round 1's P1 #3 added `operator_notification_alert_status`, the types-extend bullet still mentioned 5 tables. Round 2 reworded to enumerate all 6 tables explicitly + the 14 new `operators` columns (including `auth_email` from P1 #1). |

## Codex iteration 3 — findings (resolved in iteration 4)

| # | Finding | Resolution |
|:-:|---|---|
| P1 #1 | "Auth-email invariant is still not enforced" | Round 2 added `auth_email` as a nullable column with a partial unique index, leaving the invariant unenforced. Round 3 closes it: §3.3 migration now does ADD COLUMN → UPDATE backfill from `contact_email` → `ALTER COLUMN SET NOT NULL`, and the unique index drops the WHERE clause. Probe 4 (audit-trigger smoke), Probe 6 (approve), and Probe 7 (login) fixtures now seed `auth_email` explicitly so the NOT NULL constraint never blocks a probe. Probe 7 also tightens the `password_hash` requirement: it MUST be a real bcrypt-of-known-plaintext (not a placeholder) because step 3 verifies against it. |
| P2 #1 | "PR 2a file fence still says 15 publics" | The §4.1 inventory + §11 Probe 5 already said 17 publics after round 2. The PR 2a Files (Edit) bullet still said 15 — round 3 updated it to 17 + cross-references the §4.1 inventory by name. |
| P2 #2 | "Implementation order still says 15-public RPC layer" | §14 step 2 said "15 publics + 1 helper". Round 3 updated to 17 + the round-3 P2 #2 audit annotation. The handoff checklist + §11 Probe 5 + §10 acceptance #7 are now all consistent at 17. |

## Codex iteration 4 — findings (resolved in iteration 5)

| # | Finding | Resolution |
|:-:|---|---|
| P1 #1 | "Signup validates but ignores contact_email" | Real bug. `operator_signup` validated `p_contact_email` in step 5 but the INSERT in step 6 set `contact_email=p_email`, silently discarding the explicitly-submitted operational contact email even when the operator entered a different value. The §0 objective says signup submits `company_name + contact_email + contact_phone`, so the contact email is a first-class parameter and must be persisted. Round 4 changed the INSERT to `contact_email=p_contact_email` and rewrote the narrative to clarify `auth_email` is the immutable login identifier (entered into the login form) while `contact_email` is the operational contact submitted alongside `company_name` — they can match if the operator reused the login email but they are seeded from separate RPC parameters. |
| P2 #1 | "Probe 1 still says 13 new columns" | After round 2 added `auth_email` (taking §3.3 from 13 to 14 columns) and round 3 enforced NOT NULL, Probe 1 still said 13 columns and did not assert the NOT NULL invariant. Round 4 updated Probe 1 to "14 new columns" + added an explicit `auth_email NOT NULL` check based on the `\d+ operators` modifier column. §10 acceptance #3 (Schema, PR 1) was carrying the same stale "13 new columns" wording and was updated 13→14 in the same pass to keep all column-count references consistent across the spec. |
| P2 #2 | "Implementation order omits Probe 4a" | §14 step 1 said the founder "verifies probes 1-4" but PR 1 actually ships 5 probes after round 1 added 4a for the alert-status singleton seed. Round 4 changed the wording to "probes 1, 2, 3, 4, and 4a" so the handoff checklist matches §3 founder probes. |

## Codex iteration 5 — findings (resolved in iteration 6)

| # | Finding | Resolution |
|:-:|---|---|
| P2 #1 | "Auth/contact email prose still says same value" | Round 4 fixed the operative `operator_signup` body to persist `contact_email=p_contact_email`, but two prose locations still asserted that the signup form writes the same email to both columns: (a) §3.3 schema prose immediately after the `auth_email` migration block, and (b) §13.4 RESOLVED email-change-flow note. Both contradicted the round-4 RPC contract. Round 5 reworded both spots per Codex's prescription: signup may seed `auth_email` and `contact_email` with different values; `auth_email` is the immutable login identity, `contact_email` is the mutable operational contact. The round-5 note in §13.4 chains forward to the round-2 + round-3 audit annotations so the resolution history stays traceable. |
