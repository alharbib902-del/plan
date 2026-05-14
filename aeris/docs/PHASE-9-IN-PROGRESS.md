# Phase 9 — In Progress

> Current-state doc for resuming Phase 9 work in a new
> Claude session. Updated as each PR moves through Codex
> review → merge → activation. Read this file FIRST when
> resuming; it tells you exactly where we are and what to
> do next.

---

## 📍 Current state (last updated: PR 3 round 0 — initial commit ready for review)

| Field | Value |
|---|---|
| **Active PR** | PR 3 — Client portal (branch pushed, awaiting PR open) |
| **Branch** | `feature/phase-9-pr-3-client-portal` |
| **Code HEAD** | `62fe8ce` (PR 3 initial — 4 pages + 2 Server Actions + 5 components + 10 tests) |
| **Status** | ⏳ Ready to open PR; awaiting Codex round 1 review |
| **Last action** | PR 3 code commit pushed at `62fe8ce` (18 files, +1773/-8) |
| **Next action** | Open PR via `gh pr create` → run CI → invite Codex review |

### PR 1 + PR 2 production activation (founder, can run in parallel with PR 3 dev)

1. Apply migrations in order in Supabase:
   - `20260520000026_phase_9_pr_1_client_auth.sql`
   - `20260521000027_phase_9_pr_2_create_authenticated_trip_request.sql`
2. Set Vercel env vars (Production + Preview):
   - `ENABLE_CLIENT_PORTAL=true`
   - `CLIENT_PASSWORD_RESET_TOKEN_SECRET=<openssl rand -hex 32>`
3. Redeploy
4. Run probes per Phase 9 spec §6:
   - 9 PR 1 probes (1, 2, 3, 3-shape, 4, 4-canary, 5, 6, 7)
   - 3 PR 2 probes (8, 9, 10)

### PR 1 production activation (founder, can run in parallel with PR 2 dev)

1. Apply migration in Supabase:
   `aeris/supabase/migrations/20260520000026_phase_9_pr_1_client_auth.sql`
2. Set Vercel env vars (Production + Preview):
   - `ENABLE_CLIENT_PORTAL=true`
   - `CLIENT_PASSWORD_RESET_TOKEN_SECRET=<openssl rand -hex 32>`
3. Redeploy
4. Run the 9 PR 1 probes per Phase 9 spec §6 (probes 1, 2, 3,
   3-shape, 4, 4-canary, 5, 6, 7)

> **Note on `Code HEAD` vs `git log` tip:** the row above
> records the last *code* commit on the active branch.
> Resume-doc commits never change product behaviour, so
> `git rev-parse HEAD` may be one commit ahead of `Code
> HEAD`. See Codex round 3 PR #55 P2 #2 for the rationale.

---

## 🗺️ PR sequence

| # | PR | Status | sha | Notes |
|---|---|---|---|---|
| Spec | [#54](https://github.com/alharbib902-del/plan/pull/54) | ✅ MERGED | `62873b0` | 7 Codex rounds → 100/100 |
| PR 1 | [#55](https://github.com/alharbib902-del/plan/pull/55) | ✅ MERGED | `dfd14d1` | Client auth — 5 Codex rounds, 9 findings closed (3 P1 + 6 P2) |
| PR 2 | [#56](https://github.com/alharbib902-del/plan/pull/56) | ✅ MERGED | `25f6c52` | Charter form — 5 Codex rounds, 6 findings closed (5 P1 + 1 P2) |
| **PR 3** | (about to open) | ⏳ READY FOR REVIEW | `62fe8ce` | Client portal — 18 files, 10 new tests, 5 components |
| PR 4 | — | ⏳ pending | — | Auto-distribution engine (~800 lines) |

---

## 📚 Reference paths

| Topic | Path |
|---|---|
| **Phase 9 spec** | `aeris/docs/CLAUDE-TASK.md` |
| Phase 8 closure (lessons applied) | `aeris/docs/CLAUDE-WORK-LOG.md` (Phase 8 + addendum sections) |
| Archived Phase 8 spec | `aeris/docs/archive/CLAUDE-TASK-phase-8.md` |
| **PR 1 migration** | `aeris/supabase/migrations/20260520000026_phase_9_pr_1_client_auth.sql` |
| **PR 1 Server Actions** | `aeris/app/actions/clients-public.ts` |
| **PR 1 lib** | `aeris/lib/clients/*.ts` |
| **PR 1 tests** | `aeris/lib/clients/__tests__/*.test.ts` |

---

## 🔑 Key conventions (carry these into every PR)

These are the lessons accumulated through Phase 8 + spec
rounds that MUST be applied:

1. **NO Functions map entries** in `types/database.ts` for
   new RPCs. Phase 8 PR 2e #48 incident: parameterless
   `Args: Record<string, never>` collapsed inference for
   every other RPC. Use the `looseClient()` cast pattern
   instead.
2. **Preserve `this` binding** on Supabase `client.rpc()`.
   Cast the WHOLE client (not extract the method): Phase 8
   PR 2e #51 hotfix.
3. **REVOKE/GRANT explicit** after every `CREATE OR REPLACE
   FUNCTION` even when the prior migration already set them
   (defence against partial DR replay): Phase 8 PR #53
   round 2 hardening.
4. **`_is_sha256_hex` reused** for token-hash shape
   validation across all client RPCs that accept
   `*_token_hash`. Do NOT redefine; ACL is REVOKE ALL.
5. **Fail-closed env flags**: `process.env.X !== 'true'`,
   not `=== 'false'`. Default-disabled when unset.
6. **Opaque error contracts**: never leak which guard
   tripped. Pattern: `cancel_not_allowed` /
   `invalid_credentials` / `decline_not_allowed`.
7. **Codex 100/100 mandatory** before any merge to main.
   Branch protection enforces CI passing too.
8. **Mirror existing patterns**: when implementing a
   client-side feature, look at the operator-side first
   (Phase 8) and adapt. Do not invent new shapes.
9. **Field-shape validation in SQL is NOT optional** (Codex
   round 2 PR #55 P1 #1). A `NULLIF(TRIM())` blanket-empty
   check is insufficient for any RPC that writes to
   immutable columns or VARCHAR(N) ceilings. Required:
   per-field structured contract (`email_invalid`,
   `password_hash_malformed`, `full_name_invalid`,
   `contact_phone_invalid`) + matching length / regex
   checks. Mirror Phase 8 `operator_signup` exactly.
10. **Structured RPC failures must record degraded alert**
    (Codex round 2 PR #55 P2 #2). Any opaque-success Server
    Action that wraps an RPC needs an `else if (!result.ok)`
    branch that calls `recordClientEmailAlertStatus` with
    `{ ok: false, reason: 'send_failed', detail:
    '<rpc>_rpc_failed: <upstream_error>' }`. Otherwise admin
    canary stays 'healthy' while production silently drops
    emails.
11. **No HMAC for client sessions** (Codex round 2 PR #55
    P2 #3). Sessions are opaque random 32-byte hex stored as
    `sha256(token_hash)` — same as Phase 8 operator pattern.
    Do NOT introduce a `*_SESSION_TOKEN_SECRET` env var; it
    would imply a security property that doesn't exist.
    Reset tokens DO use HMAC (`CLIENT_PASSWORD_RESET_TOKEN_SECRET`)
    because they travel in the URL.
12. **Never mask a missing client IP with a sentinel like
    `'0.0.0.0'`** (Codex round 3 PR #55 P2 #1). For any
    Server Action that writes to a NOT NULL `ip_address`
    column (signup attempts), do the check between Zod parse
    and bcrypt:
    ```ts
    const ip = clientIp();
    if (!ip) return { ok: false, error: 'ip_required' };
    ```
    A sentinel collapses honest users into one bucket so the
    24h rate-limit blocks unrelated signups, AND it
    neutralises the matching `ip_required` RPC contract
    (probes can't validate the missing-IP path because the
    Server Action prevents it from firing). Login + reset
    actions DO pass `clientIp()` directly because their
    target columns (`*_sessions.ip_address`,
    `*_password_reset_tokens.ip_address`) are nullable INET.
13. **Every RPC that writes `password_hash` MUST validate
    bcrypt format** (Codex round 4 PR #55 P2 #1). Both signup
    AND reset paths need the full triple-check before any
    UPDATE/INSERT touches the column:
    ```sql
    IF p_new_password_hash IS NULL
       OR length(p_new_password_hash) <> 60
       OR p_new_password_hash !~ '^\$2[aby]\$'
    THEN
      RETURN json_build_object('ok', false,
        'error', 'password_hash_malformed');
    END IF;
    ```
    A NULL/empty-only guard is insufficient: a buggy Server
    Action or repair script could store a non-bcrypt string
    and the client could not log in afterwards (and on the
    reset path, the single-use token has already been
    consumed at that point — no recovery without admin).
    Use the `password_hash_malformed` contract (already in
    `clientsAr.errors`) so vocabulary stays consistent
    across signup + reset.
14. **When introducing a new identity table, sweep ALL FKs
    that point at the legacy table** (Codex round 1 PR #56
    P1 #1). PR 2 retargeted `trip_requests.client_id` from
    `users(id)` to `clients(id)`, but missed
    `bookings.client_id` — `accept_offer` would have died
    at booking creation with a 23503 FK violation. Audit
    the full graph: `bookings`, `loyalty_transactions`,
    `notifications`, `medevac_requests`, `cargo_requests`,
    etc. Phase 9 only retargets the path the new flow
    actually walks (`trip_requests` → `accept_offer` →
    `bookings`); the rest stay on `users(id)` until their
    own client-portal flows land.
15. **Reference-table existence check before INSERT, don't
    rely on FK violation as the structured contract**
    (Codex round 1 PR #56 P1 #2). When an RPC accepts a
    free-text value that maps to a FK-backed column
    (IATA codes → `airports(iata_code)`), do an explicit
    `IF NOT EXISTS (SELECT 1 FROM ... WHERE ...) THEN
    RETURN structured_error END IF;` BEFORE the INSERT.
    Otherwise the Server Action sees a raw `23503
    foreign_key_violation` PostgreSQL error code instead of
    a friendly per-field contract. Two contracts when the
    field could be either side (e.g. `departure_airport_unknown`
    + `arrival_airport_unknown`) so the form can highlight
    the offending field.
16. **`<input type="datetime-local">` ALWAYS needs an
    explicit Asia/Riyadh `+03:00` suffix before the Server
    Action call** (Codex round 1 PR #56 P2 #3 + Phase 7
    round-2 P2 #1). The browser interprets the naive value
    in the user's local zone, so a non-Riyadh user storing
    14:00 ends up with the wrong instant in TIMESTAMPTZ.
    The shared helper lives at
    `lib/utils/datetime-local.ts` (`datetimeLocalToRiyadhIso`);
    every form that ships a `datetime-local` value to a
    SECURITY DEFINER RPC MUST call it.
17. **NEVER eagerly `VALIDATE CONSTRAINT` after retargeting
    a FK in a migration that ships in front of any potential
    legacy data** (Codex round 2 PR #56 P1 #1). PR 2 retargeted
    `trip_requests.client_id` and `bookings.client_id` from
    `users(id)` to `clients(id)`. Adding the new FK as
    `NOT VALID` and immediately running `VALIDATE CONSTRAINT`
    in the same migration would block production activation /
    DR replay if any legacy `users(id)`-backed pointer
    survived in either table. Defer the `VALIDATE` to a
    follow-up cleanup migration after activation is cold-quiet.
18. **`NOT VALID` is NOT enough on its own — inline-backfill
    legacy orphans inside the same FK-retarget migration**
    (Codex round 3 PR #56 P1 #1). PostgreSQL still applies a
    `NOT VALID` FK to every forward INSERT/UPDATE; only
    pre-existing rows are skipped. So the moment a downstream
    RPC (Phase 6 `accept_offer` copying `v_trip.client_id`
    into `bookings.client_id`) tries to write a still-orphaned
    legacy pointer, the new FK rejects it. The correct
    pattern for an identity-table FK retarget is:
    1. DROP old FK
    2. **Inline-backfill orphans (3 ordered UPDATEs per
       table)**:
       a. snapshot-fill from the legacy table (e.g. `users`)
          for orphans whose legacy row still exists, into
          whatever snapshot columns the row has
          (`customer_name`/`customer_phone` on
          trip_requests; `customer_name_snapshot`/
          `customer_phone_snapshot` on bookings — yes the
          column names DIFFER between tables). **ALWAYS
          width-truncate the source via `LEFT(src, n)`** if
          the source column is wider than the target
          (`users.full_name` is `VARCHAR(200)` and the
          snapshots are `VARCHAR(120)` — Codex round 4 PR
          #56 P1 #1: a 120+ char legitimate name otherwise
          aborts the migration with `value too long for
          type character varying(120)`). Pipe phone-like
          source values through `NULLIF(BTRIM(src), '')` so
          empty-string rows fall through to the placeholder
          rather than overwriting the snapshot with a blank;
       b. placeholder-fill (e.g. `'Legacy customer'` /
          `'unknown'`) for orphans whose legacy row is also
          gone, so any identity_check passes after NULL;
       c. `UPDATE … SET fk_column = NULL WHERE fk_column IS
          NOT NULL AND NOT EXISTS (SELECT 1 FROM new_table
          WHERE id = fk_column);`
    3. ADD new FK with `NOT VALID` (per #17 above).
    4. Defer `VALIDATE CONSTRAINT` to cleanup migration.
    The UPDATEs are idempotent (orphan filter no longer
    matches once NULLed) so DR replay is safe.

---

## ▶️ Resume instructions

### If you're resuming PR 3 mid-flight

1. `git checkout feature/phase-9-pr-3-client-portal`
2. Read Phase 9 spec §5 PR 3 inventory (below) plus the
   spec round 4 P1 #2 single-conditional-UPDATE pattern for
   `clientDeclineOffer`.
3. Continue from the open todo (`git status` to see what's
   staged); validate (type-check + lint + new test) before
   each push.

### PR 3 inventory (Phase 9 spec §5)

- **No migration** (reuses existing tables — `trip_requests`,
  `phase4_operator_offers`, `phase5_operator_offers`,
  `bookings`, `accept_offer` RPC).
- **4 pages** under `app/(client)/me/`:
  - `requests/page.tsx` — list with status chips +
    `?status=` filter (`all|pending|distributed|offered|
    booked|cancelled`)
  - `requests/[id]/page.tsx` — detail (metadata + status
    timeline + offers via `UnifiedOfferCard` + accept /
    decline / cancel-trip buttons)
  - `bookings/page.tsx` — read-only list (status='booked'
    trips)
  - `bookings/[id]/page.tsx` — booking detail (operator
    snapshot, route, add-ons)
- **2 NEW Server Actions** (extend
  `app/actions/clients-trip-requests.ts`):
  - `clientAcceptOffer` — pre-SELECT trip ownership +
    `accept_offer(source, offer_id)` RPC + revalidate
  - `clientDeclineOffer` — single conditional UPDATE on
    `phase4_operator_offers` OR `phase5_operator_offers`
    with three guards ANDed in the WHERE clause (Codex
    round 4 P1 #2 fix on spec): trip ownership, offer
    `status='pending'`, parent trip `status IN
    ('distributed','offered')`. Zero rows → opaque
    `decline_not_allowed`.
- **`cancelMyTripRequest`** already shipped in PR 2 — PR 3
  just adds the UI button on the request detail page.
- **Components** (~10):
  - reuse `UnifiedOfferCard` (existing) for offer rendering
  - new `requests-table.tsx`, `request-detail.tsx`,
    `bookings-table.tsx`, `booking-detail.tsx`,
    `accept-offer-button.tsx`, `decline-offer-button.tsx`,
    `cancel-trip-button.tsx`
- **Validators** extended in `lib/validators/clients.ts`:
  `acceptOfferSchema` (offer_id UUID + source enum),
  `declineOfferSchema` (same)
- **i18n** entries added to `clientsAr`: status chip labels,
  table headers, action labels, `decline_not_allowed` /
  `accept_failed` error contracts
- **1 test suite** for the new validators

### When PR 3 reaches Codex 100/100

1. Merge PR 3 (squash + delete branch)
2. Sync main locally
3. Update this file: PR 3 row → ✅ MERGED + merge sha
4. Set Active PR row to PR 4
5. Begin PR 4 (auto-distribution engine — `score_operators_for_trip`,
   `auto_dispatch_trip_request`, `/api/trip-distribution/internal/dispatch`,
   PR 4 cron drains, per Phase 9 spec §5)

---

## 📋 PR 1 inventory (for grant probe + final closure)

### 10 publics (all `service_role`-granted)

```
client_signup
client_login_lookup
client_login_create_session
client_logout
client_session_validate
client_mint_password_reset_token
client_verify_password_reset
cleanup_expired_client_sessions
cleanup_expired_client_password_reset_tokens
cleanup_old_client_signup_attempts
```

### 1 helper (REVOKE ALL — function-owner only)

```
_normalize_client_email
```

### 1 reused Phase 8 helper (ACL must be unchanged)

```
_is_sha256_hex
```

### 5 new tables

```
clients
client_sessions
client_password_reset_tokens
client_signup_attempts
client_notification_alert_status
```

### 1 ENUM

```
client_status (active | suspended | deleted)
```

### Cron CHECK extension

`operator_cron_tick_history_job_name_check` extended with
3 new client cleanup job names (PR 4 will add the 4th
`redispatch_stale_trip_requests`).

---

## 🚨 Open risks / unresolved

PR #55 → MERGED at `dfd14d1` after Codex round 5 (0
findings, 100/100). Cumulative findings closed across all 5
rounds: **9 total — 3 P1 + 6 P2.**

Open items:
- **PR 1 production activation pending** — see "PR 1
  production activation" panel at the top. Founder action
  out of band; doesn't block PR 2 review.
- **PR 1 + PR 2 production activation pending** — see
  panel at the top of this doc. Founder action out of band;
  doesn't block PR 3 review.
- **PR 3 — code committed at `62fe8ce`, branch pushed,
  awaiting `gh pr create` + Codex round 1.** Validation
  green locally (TS clean, ESLint 0, 58 client tests pass:
  10 reset-token + 6 auth-session + 10 email-normalize +
  16 trip-request-validators + 6 datetime-local + 10 offer-
  action-validators).
- **Follow-up cleanup migration (lighter scope after PR 2
  round 3)**: post-Phase 9 activation, run `ALTER TABLE …
  VALIDATE CONSTRAINT` on both `*_client_id_clients_fkey`.
  PR 2 round 3's inline backfill already cleared every legacy
  orphan; the deferred VALIDATE is now just a
  belt-and-braces safety net.

---

## 📜 Update protocol

Every time this file's "Current state" changes (PR moves
from open → merged, new PR opens, new round of Codex
findings, etc.), the next conversation MUST:

1. Update the **Current state** table at the top.
2. Update the **PR sequence** table.
3. Append any **new lessons** to "Key conventions".
4. Adjust the **Resume instructions** for the new state.

**Two-commit rhythm per round (Codex round 3 PR #55 P2 #2
discipline).** Push the code fixes first, then update this
doc to point at the code-fix SHA, then push the doc commit.
The "Code HEAD" row records the last *code* commit, not the
doc commit itself — `git rev-parse HEAD` will be one ahead.
The doc-only commit never changes product behaviour, so
this divergence is acceptable as long as the row in the
Current state table is correct as of the last *code* push.

The doc is the single source of truth for "where are we?"
in Phase 9 — keep it accurate.
