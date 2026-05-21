# Phase 13 — Aeris Privilege activation notes

> **Status:** PENDING activation — runbook published, production
> rollout awaits the founder's go signal.
>
> **Scope:** Phase 13 spec (PR #80) + PR 1 backend + admin
> tier-change UI (PR #81) + PR 2 client UI + cashback redeem input
> + 2FA banner (PR #82) + PR 3 distribution + cron + cross-product
> (PR #83).
>
> **Concurrent security cutover** (must deploy together because
> several migrations + env vars are intertwined): PRs #84, #86,
> #87, #88, #89, #90, #91, #92, #93, #94 (Option B admin accounts
> + TOTP MFA + per-IP/per-admin rate-limits + dep cleanup).
>
> This file is the founder's step-by-step runbook. Mark
> checkboxes inline + record exact dates / commit SHAs as you
> execute.

---

## Timeline

| Step | Date | Reference |
|---|---|---|
| Phase 13 spec accepted at 100/100 | `2026-05-19` | PR #80 (merged `92c9a50`) |
| PR 1 (backend + admin tier-change UI) merged | `2026-05-19` | PR #81 (merged `6d01269`) |
| PR 2 (client UI + cashback redeem input + 2FA banner) merged | `2026-05-19` | PR #82 (merged `b58b8ba`) |
| PR 3 (distribution + cron + cross-product) merged | `2026-05-19` | PR #83 (merged `cd29e33`) |
| Security PRs #84–#95 merged | `2026-05-21` | latest `30f60c6` |
| Migrations applied to production Supabase | `TODO` | Founder fills in |
| Env vars set on Vercel (production environment) | `TODO` | Founder fills in |
| Founder seeded via `/admin/login` | `TODO` | Founder fills in |
| `ADMIN_INBOX_PASSWORD` rotated + removed | `TODO` | Founder fills in |
| `D:/Plan/password manage.txt` deleted | `TODO` | Founder fills in |
| `ENABLE_PRIVILEGE=true` flipped on production | `TODO` | Founder fills in |
| Smoke probes 41–48 executed | `TODO` | Founder fills in |
| Phase 13 activated on production | `TODO` | Founder fills in |

---

## 1. Migrations to apply (in order)

All migrations are **replay-safe** (Phase 9 conventions: `DO $$
BEGIN IF NOT EXISTS … END $$`, `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `ON
CONFLICT (…) DO NOTHING` for seeds). Safe to re-apply on top of
themselves; failure halfway through can be retried.

Apply via Supabase SQL Editor against the production project:

### Phase 13 migrations

1. **`20260519000043_phase_13_pr_1_privilege_intake.sql`** (~931 lines)
   - Extends `clients` with privilege columns (tier, assigned_at,
     qualified_spend_12m_sar, below_threshold_since,
     tier_locked_until, cashback_balance_sar, two_factor_enabled).
   - New tables: `privilege_tier_thresholds` (4-row seed),
     `client_loyalty_ledger`, `privilege_tier_change_log`.
   - 11 RPCs (award / redeem / adjust / expire / evaluate /
     force / etc.) — all SECURITY DEFINER with REVOKE+GRANT ACL
     contract per Phase 9 convention.
   - Trigger `enforce_paid_immutability` on `bookings`.
   - RLS deny-by-default on every new table.

2. **`20260520000044_phase_13_pr_3_privilege_distribution.sql`** (~600 lines)
   - 1 new table: `client_empty_leg_matches` (D13/D27 UNIQUE).
   - 4 new triggers: `BEFORE stamp paid_at × 2` +
     `AFTER award + evaluate × 2` (F1 BEFORE/AFTER split deferred
     from PR 1).
   - 4 new RPCs: `expire_old_loyalty_credits`,
     `auto_grant_diamond_shield_subscription`,
     `schedule_diamond_shield_revoke`,
     `reconcile_client_cashback_balance`.
   - Updates `evaluate_client_privilege_tier` to wire Diamond ×
     Shield hooks.

### Concurrent security migrations

3. **`20260528000045_admin_login_rate_limit.sql`** — PR #86.
   `admin_login_attempts` ledger + cleanup RPC.
4. **`20260528000046_public_action_rate_limit.sql`** — PR #87.
   `public_action_attempts` ledger + cleanup RPC.
5. **`20260528000047_admin_accounts_schema.sql`** — PR #88.
   `admin_users` + `admin_user_sessions` + cleanup RPC.
6. **`20260528000048_admin_mfa_schema.sql`** — PR #90.
   `admin_mfa_secrets` + `admin_mfa_recovery_codes` + touch
   trigger.
7. **`20260528000049_admin_user_sessions_mfa_pending.sql`** — PR #92.
   Adds `mfa_pending` column to `admin_user_sessions` + partial
   index.
8. **`20260528000050_admin_mfa_challenge_rate_limit.sql`** — PR #92.
   `admin_mfa_challenge_attempts` ledger + extends
   `admin_login_attempts.outcome` CHECK + cleanup RPC.

> **Note:** Migrations 3–8 do NOT depend on Phase 13 at all —
> they can be applied independently. They're listed here because
> the deploy window is shared.

---

## 2. Env vars to set (Vercel production)

| Var | Required? | Purpose | Notes |
|---|---|---|---|
| `ENABLE_PRIVILEGE` | required for Phase 13 | Activation gate. Leave UNSET or `false` initially; flip to `true` AFTER Probe 41 passes | D20 |
| `ADMIN_AUTH_SECRET` | already required | HMAC secret for session signatures + rate-limit fingerprints | Validated by `requireAdminEnv()` at startup |
| `ADMIN_INBOX_PASSWORD` | required ONCE (founder seed) | The old shared password. Used ONLY by founder-seed branch when `admin_users` is empty. Can be unset after founder seeds + rotates | PR #89 cutover |
| `ADMIN_FOUNDER_EMAIL` | required for founder seed | Email of the first admin row to seed automatically | PR #89. Lowercase, valid email format |
| `ADMIN_FOUNDER_NAME` | optional | Display name on the founder row. Defaults to `'Founder'` | PR #89 |
| `CRON_SECRET` | already required | Vercel cron auth. Also falls back as the rate-limit fingerprint secret | PR #84 / #87 |
| `RATE_LIMIT_FINGERPRINT_SECRET` | optional | Dedicated HMAC secret for public-action rate-limit fingerprints. If unset, `CRON_SECRET` is used | PR #87 |
| `ADMIN_AUDIT_FINGERPRINT_SECRET` | already required | Audit-log fingerprint HMAC (Phase 12 admin-pii) | Verified during Phase 12 activation |

### Pre-activation env-var checklist

- [ ] `ENABLE_PRIVILEGE` exists, value = `false` (or unset)
- [ ] `ADMIN_FOUNDER_EMAIL` exists, contains a valid email you
      can receive at
- [ ] `ADMIN_INBOX_PASSWORD` still set (will be removed AFTER
      founder seeds + rotates a fresh password)
- [ ] `ADMIN_AUTH_SECRET` length ≥ 16 chars (validated server-side)
- [ ] `CRON_SECRET` set
- [ ] `ADMIN_AUDIT_FINGERPRINT_SECRET` set (carried over from
      Phase 12)

---

## 3. Vercel cron entries

The 3 NEW cron paths (added by `vercel.json` in PRs #83 + #87):

| Path | Schedule | Source |
|---|---|---|
| `/api/cron/privilege/evaluate-all` | `0 3 * * *` (03:00 UTC = 06:00 Riyadh, daily) | PR #83 |
| `/api/cron/privilege/expire-cashback` | `0 4 * * *` (04:00 UTC = 07:00 Riyadh, daily) | PR #83 |
| `/api/cron/cleanup/public-action-attempts` | `0 5 * * *` (05:00 UTC, daily) | PR #87 |

> **Note:** the privilege spec also references a third cron
> (`reconcile-balances`) — that route was NOT shipped in PR 3;
> reconciliation is currently report-only via direct RPC call.
> Documented for future work.

After the Vercel deploy from `main`, confirm:

- [ ] Vercel → Project → Settings → Crons lists all 3 new entries
- [ ] Each shows `CRON_SECRET` auth wired (no anonymous schedule)

---

## 4. Activation sequence

Execute in this exact order. Each step gates the next.

### Step 1 — Apply all 8 migrations

- [ ] Open Supabase Dashboard → SQL Editor on production project
- [ ] For each migration file in order (Phase 13 first, then
      security):
  - [ ] Open the file from the repo
  - [ ] Paste the entire contents into a new SQL editor tab
  - [ ] Run. Verify zero errors. Replay safety means
        already-applied migrations are no-ops.
- [ ] After all 8: run a quick sanity SELECT on each new table:
      `SELECT COUNT(*) FROM client_loyalty_ledger;` etc.

### Step 2 — Deploy `main` to Vercel production

- [ ] Push / merge to `main` is already there (commit `30f60c6`
      or later)
- [ ] Vercel auto-deploys. Verify the build succeeds.
- [ ] Verify cron entries appear in Vercel dashboard (step 3
      above)

### Step 3 — Founder login + seed

The first `/admin/login` after deploy triggers the auto-seed flow
(PR #89). The auto-seed branch fires IFF:
1. `admin_users` table is empty (post-migration state)
2. Submitted email matches `ADMIN_FOUNDER_EMAIL` env exactly
   (case-insensitive)
3. Submitted password matches the still-present
   `ADMIN_INBOX_PASSWORD` env (constant-time compare)

If all three match, the seed inserts the founder row with:
- `role = 'owner'`
- `must_change_password = true`
- `password_hash = bcrypt(ADMIN_INBOX_PASSWORD)`

Execute:

- [ ] Visit `https://<production-domain>/admin/login`
- [ ] Enter `ADMIN_FOUNDER_EMAIL` + the current shared password
- [ ] Verify automatic redirect to `/admin/account/password`
- [ ] Choose a NEW strong password (12+ chars, lower + upper +
      digit). Confirm. Submit.
- [ ] Verify redirect to `/admin/leads` (or any admin page —
      `must_change_password` gate is now cleared)

### Step 4 — Remove `ADMIN_INBOX_PASSWORD` IMMEDIATELY

Round-1 review on PR #96 P1: the shared env-bound password
existed for exactly ONE purpose — the one-shot founder seed in
Step 3. After that runs successfully, the env var is dead weight
that widens the credential surface for every minute it remains
set. Pull it BEFORE any MFA / smoke probe / flag flip so the
attack window is as narrow as possible.

- [ ] Vercel → Project → Settings → Environment Variables
- [ ] DELETE `ADMIN_INBOX_PASSWORD` on the Production environment
      (preferred; rotating to a fresh random value is acceptable
      but DELETE is cleaner — the auto-seed branch is now dead
      anyway because `admin_users` is non-empty)
- [ ] Trigger a redeploy (so the running serverless instances no
      longer have the value in `process.env`)
- [ ] Verify a fresh `/admin/login` attempt with the OLD shared
      password fails with `invalid_credentials`

Companion outside-repo action — see Section 5.2 — should follow
in the SAME session: delete `D:/Plan/password manage.txt` from
the founder's local machine now that the env-bound copy is gone.

### Step 5 — Enroll MFA for the founder

- [ ] Visit `/admin/account/mfa/enroll`
- [ ] Scan the QR code with an authenticator app (Authy / Google
      Authenticator / 1Password / etc.)
- [ ] Enter the 6-digit code → confirm
- [ ] **Save the 10 recovery codes to a password manager.** They
      are shown ONCE.
- [ ] Verify the manage page now shows "المصادقة الثنائية مفعّلة"

### Step 6 — Cycle the session to verify the full flow

- [ ] Click logout
- [ ] Log back in with the NEW password
- [ ] Verify redirect to `/admin/login/mfa`
- [ ] Enter a fresh 6-digit OTP → confirm
- [ ] Verify redirect to `/admin/leads`

### Step 7 — Run smoke probes

See **Section 6** below for the per-probe checklist.

### Step 8 — Flip `ENABLE_PRIVILEGE=true`

- [ ] Vercel → Project → Settings → Environment Variables
- [ ] Set `ENABLE_PRIVILEGE=true` on **Production** environment
- [ ] Redeploy (any push to main, or a manual "Redeploy" from the
      Vercel UI)
- [ ] Verify `/admin/clients` shows a privilege tier badge per
      client (everyone starts at `silver` by the PR 1 backfill)
- [ ] Verify `/me/privilege` (signed in as a client) shows the
      tier dashboard

### Step 9 — Cloudflare WAF + Phase 13 status flip (see Section 5)

The two narrow outside-repo actions (rotate env + delete local
file) already happened in Step 4 + Section 5.2 above. The
optional Cloudflare WAF rules in Section 5.3 are the last
hardening step and can land any time after Step 8.

---

## 5. Founder actions outside the repo

These cannot be done from inside the repository and require the
founder. **Execute in order.**

### 5.1 — Rotate / remove `ADMIN_INBOX_PASSWORD` (already covered in Step 4)

Already executed inline as Step 4 of Section 4 above. This row
stays in the runbook as a pointer so a future reader scanning
Section 5 (founder-outside-repo actions) doesn't miss the
companion task.

### 5.2 — Delete `D:/Plan/password manage.txt`

The file lives outside the repo (on the founder's local machine)
and was flagged in the security review as a plaintext credential
file. After the rotation in 5.1, the file's contents are
worthless to an attacker — but the file itself should be removed
to close the loose-credential surface entirely.

- [ ] Confirm 5.1 is done (so deleting the file doesn't lock
      anyone out of an unrotated env)
- [ ] Move any non-credential context from the file into a real
      password manager (1Password / Bitwarden / similar)
- [ ] Delete `D:/Plan/password manage.txt`
- [ ] Empty the OS recycle bin

### 5.3 — Cloudflare WAF + IP allowlist on `/admin/*` (optional, recommended)

Not part of the repo; configured in the Cloudflare dashboard for
the `aeris.sa` zone. Lowers the noise floor against the
admin-login rate-limit (which is the defence of last resort).

- [ ] Cloudflare → `aeris.sa` zone → Security → WAF → Custom
      rules
- [ ] Rule 1 (rate-limit): `/admin/login` and `/admin/login/mfa`
      paths, 10 req/min/IP, action = challenge
- [ ] Rule 2 (allowlist, optional): if the operator team is
      geographically concentrated, restrict `/admin/*` to known
      country codes (Saudi Arabia + selected travel destinations)
- [ ] Confirm the rules are enabled + Vercel still receives
      Cloudflare's `x-forwarded-for` header (needed by the
      per-actor rate-limit fingerprint)

---

## 6. Smoke probes

8 probes defined in `docs/PHASE-13-PRIVILEGE-SPEC.md` (Probes
41–48). Run each, mark pass/fail + paste any verbatim DB output
into the matching `Probes results` section below.

### Probe 41 — Schema state (50+ SQL checks, before flag flip)

- [ ] Run the probe SQL (per spec §11 Probe 41)
- [ ] Verify all checks `passed = X / X` with 0 failed
- [ ] Verdict: GREEN → proceed to step 6

### Probe 42 — Earn cashback on payment confirmation

- [ ] Pick a paid `bookings` row from charter, cargo, or medevac
- [ ] Run `SELECT * FROM client_loyalty_ledger WHERE booking_id =
      '<that booking id>';`
- [ ] Verify exactly one `earn` row with the expected amount

### Probe 43 — Redeem cashback within D7 cap

- [ ] Pick a client with balance ≥ 1000 SAR
- [ ] Accept a charter/cargo/medevac offer with cashback redemption
      set to 50% of total_amount
- [ ] Verify the booking is created + a `redeem` ledger entry posted

### Probe 44 — Auto-upgrade silver → gold

- [ ] Pick a client at silver
- [ ] Pay a booking that pushes their 12-month qualified spend
      across the gold threshold (100k SAR)
- [ ] Verify `clients.privilege_tier` flipped to `gold` + a
      `privilege_tier_change_log` row was added

### Probe 45 — Auto-upgrade platinum → diamond + Shield grant

- [ ] Pick a client at platinum
- [ ] Push their spend across the diamond threshold (2M SAR)
- [ ] Verify diamond tier assigned AND a free Aeris Shield
      subscription was granted (D11)

### Probe 46 — Soft downgrade after 90-day grace

- [ ] Pick a client whose 12-month spend dropped below their
      current tier threshold > 90 days ago
- [ ] Trigger the daily evaluate cron manually (or wait for
      03:00 UTC tick)
- [ ] Verify a `downgrade_one_step` change_log entry was added

### Probe 47 — EL early access via distribution scoring

- [ ] Publish a new empty leg
- [ ] Verify Gold/Platinum/Diamond clients matching the route are
      notified in the early window (per D13 boost hours)
- [ ] Verify silver clients are notified ONLY after the boost
      window expires

### Probe 48 — Admin force + lock + Shield grant on Diamond

- [ ] As admin, force a client to diamond via `/admin/clients/[id]/privilege/force`
- [ ] Verify `tier_locked_until` is set
- [ ] Verify a free Shield subscription was granted (D26)

---

## 7. Rollback procedure

If any probe fails OR `ENABLE_PRIVILEGE=true` triggers production
errors:

1. **Immediate:** Vercel → Set `ENABLE_PRIVILEGE=false` →
   Redeploy. The privilege UI hides, cron routes self-skip,
   accept actions stop processing cashback redemption.
2. **Migrations stay applied** — they're additive + RLS
   deny-by-default. A disabled flag is functionally equivalent
   to pre-migration state for end users.
3. **If a specific PR caused the issue:** revert that PR via `gh
   pr` (creates a revert PR), merge, redeploy.
4. **Break-glass: founder admin login broken** (e.g. lost MFA
   device, password forgotten, session subsystem in a bad
   state). Round-1 review on PR #96 P1: do NOT empty
   `admin_users` — that would CASCADE-delete every admin row,
   every session, and every MFA secret for any other admins the
   founder later added. The narrow, recoverable break-glass:
   1. Pick a known temporary password — call it
      `<TEMP_PASSWORD>`. Compute its bcrypt hash via a one-line
      Node REPL: `node -e 'require("bcryptjs").hash("<TEMP_PASSWORD>",
      12).then(console.log)'`.
   2. In the Supabase SQL Editor, run:
      ```sql
      UPDATE admin_users
         SET password_hash         = '<paste bcrypt hash>',
             must_change_password  = true,
             disabled_at           = NULL,
             status                = 'active'
       WHERE email = '<ADMIN_FOUNDER_EMAIL value>';

      UPDATE admin_user_sessions
         SET revoked_at = NOW(),
             revoked_by_admin_user_id = (
               SELECT id FROM admin_users
                WHERE email = '<ADMIN_FOUNDER_EMAIL value>'
             )
       WHERE admin_user_id = (
         SELECT id FROM admin_users
          WHERE email = '<ADMIN_FOUNDER_EMAIL value>'
       )
         AND revoked_at IS NULL;

      DELETE FROM admin_mfa_secrets
       WHERE admin_user_id = (
         SELECT id FROM admin_users
          WHERE email = '<ADMIN_FOUNDER_EMAIL value>'
       );

      DELETE FROM admin_mfa_recovery_codes
       WHERE admin_user_id = (
         SELECT id FROM admin_users
          WHERE email = '<ADMIN_FOUNDER_EMAIL value>'
       );
      ```
   3. Login again with `<ADMIN_FOUNDER_EMAIL>` + `<TEMP_PASSWORD>`.
      The `must_change_password=true` flag forces immediate
      rotation; no MFA challenge fires because the secret row
      was deleted. Re-enroll MFA via Step 5.
   4. **Do NOT use this as a normal admin-reset path** — it
      bypasses the password-knowledge + OTP gates that protect
      the disable flow in PR #92. It's strictly for the
      founder's own account when no other admin can perform a
      proper reset.

---

## 8. Post-activation cleanup

After Phase 13 is stable for 7 days:

- [ ] Confirm `ADMIN_INBOX_PASSWORD` removed from Vercel
- [ ] Confirm `D:/Plan/password manage.txt` deleted
- [ ] Confirm Cloudflare WAF rules in place (optional)
- [ ] Update Phase 13 spec status flag (`docs/PHASE-13-PRIVILEGE-SPEC.md`
      header) from `PENDING` to `LIVE`
- [ ] Close the security review tracking issue if any
- [ ] File the next planning artifact (Next 14→16 migration spec,
      Phase 14 payment spec, etc.)

---

## Probes results

Founder fills in below as each probe is executed.

### Probe 41 — Schema state

*Not yet executed.*

### Probe 42 — Earn cashback on payment confirmation

*Not yet executed.*

### Probe 43 — Redeem cashback within D7 cap

*Not yet executed.*

### Probe 44 — Auto-upgrade silver → gold

*Not yet executed.*

### Probe 45 — Auto-upgrade platinum → diamond + Shield grant

*Not yet executed.*

### Probe 46 — Soft downgrade after 90-day grace

*Not yet executed.*

### Probe 47 — EL early access via distribution scoring

*Not yet executed.*

### Probe 48 — Admin force + lock + Shield grant on Diamond

*Not yet executed.*

---

## Sign-off

- [ ] All 8 probes executed + results recorded above
- [ ] `ENABLE_PRIVILEGE=true` on production for 7 consecutive days
      with zero canary alerts
- [ ] Status flag flipped to LIVE
- [ ] Phase 13 closure notes filed (if separate doc)
