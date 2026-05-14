# Phase 9 — In Progress

> Current-state doc for resuming Phase 9 work in a new
> Claude session. Updated as each PR moves through Codex
> review → merge → activation. Read this file FIRST when
> resuming; it tells you exactly where we are and what to
> do next.

---

## 📍 Current state (last updated: Phase 9 CODE COMPLETE 🎉)

| Field | Value |
|---|---|
| **Active PR** | — (none; Phase 9 code is fully merged) |
| **Branch** | `main` (all 4 Phase 9 PRs merged) |
| **Code HEAD** | `deb449b` on `main` (squash-merge of PR #58) |
| **Status** | ✅ Phase 9 CODE COMPLETE; awaiting founder activation + 22-probe sweep |
| **Last action** | PR #58 merged at `deb449b` after Codex round 4 accepted 100/100 (4 rounds, 11 findings closed: 7 P1 + 4 P2 — the largest PR in Phase 9) |
| **Next action** | Founder runs final activation (apply 3 migrations + set env vars + flip `ENABLE_TRIP_AUTO_DISTRIBUTION=true` after probes 16 + 17 pass) + 22-probe sweep, then closes Phase 9 |

### Final production activation (founder)

1. **Apply 3 migrations** in Supabase (in order):
   - `20260520000026_phase_9_pr_1_client_auth.sql`
   - `20260521000027_phase_9_pr_2_create_authenticated_trip_request.sql`
   - `20260522000028_phase_9_pr_4_auto_distribution.sql`
   - (PR 3 ships no migration)
2. **Set Vercel env vars** (Production + Preview):
   - `ENABLE_CLIENT_PORTAL=true`
   - `CLIENT_PASSWORD_RESET_TOKEN_SECRET=<openssl rand -hex 32>`
   - `PHASE_9_MIN_DISPATCH_FANOUT=2` (default; raise after live tuning)
   - `TRIP_REDISPATCH_STALE_HOURS=4` (default; lower to `0.01` ONLY for probe 18 smoke)
   - `ENABLE_TRIP_AUTO_DISTRIBUTION=false` (start OFF; flip to `true` only after probes 16 + 17 pass)
3. **Redeploy**
4. **Run 22 probes** per Phase 9 spec §6:
   - 9 PR 1 probes (1, 2, 3, 3-shape, 4, 4-canary, 5, 6, 7)
   - 3 PR 2 probes (8, 9, 10)
   - 4 PR 3 probes (11, 12, 13, 14)
   - 6 PR 4 probes (15, 16, 17, 18, 19, 20)
5. **Flip auto-dispatch** after probes 16 + 17 pass:
   - Set `ENABLE_TRIP_AUTO_DISTRIBUTION=true` in Vercel
   - Redeploy
6. **Close Phase 9** by archiving this doc to
   `aeris/docs/archive/PHASE-9-CLOSURE.md` and adding a
   summary section to `aeris/docs/CLAUDE-WORK-LOG.md`.

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
| PR 3 | [#57](https://github.com/alharbib902-del/plan/pull/57) | ✅ MERGED | `05f5713` | Client portal — 2 Codex rounds, 1 P2 closed (fastest in Phase 9) |
| PR 4 | [#58](https://github.com/alharbib902-del/plan/pull/58) | ✅ MERGED | `deb449b` | Auto-distribution — 4 Codex rounds, 11 findings closed (7 P1 + 4 P2 — the largest PR) |

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
19. **Every route param that flows into a Postgres UUID
    comparison MUST be UUID-shape-checked first** (Codex
    round 1 PR #57 P2 #1). Without the guard, PostgREST
    rejects the comparison with 22P02
    invalid_text_representation, the calling helper throws,
    and the page renders a 500 instead of the intended
    not-found / opaque state. The shared helper is
    `lib/utils/uuid.ts` (`isUuid()` — version-agnostic
    so both `uuid_generate_v4` and `uuid_generate_v7`
    pass). Collapse malformed inputs into `null` at the
    helper boundary so the page's existing not-found UX
    handles the case.
20. **Cron RPCs use `record_operator_cron_tick`, NEVER a
    direct INSERT against `operator_cron_tick_history`**
    (Codex round 1 PR #58 P1 #1). The table is append-only
    with `ran_at`/`deleted_count`/`success`/`error_label`
    and has NO UNIQUE constraint on `job_name`, so a
    direct INSERT with `last_tick_at` + `ON CONFLICT
    (job_name)` (the wrong shape) fails the very first
    cron tick AND rolls back any work the RPC did before
    that line. Always go through the helper.
21. **CHECK extensions on shared constraints MUST restate
    the EXACT existing list** (Codex round 1 PR #58 P1
    #2). Each PR that touches `operator_cron_tick_history_job_name_check`
    drops + re-adds the constraint with the full allowed
    set. Restating from memory is dangerous — any drift
    (`_otp_tokens` vs the real `_otp_codes`,
    `cleanup_old_operator_signup_attempts` vs
    `cleanup_old_signup_attempts`) either fails on
    production rows or silently breaks future cron writes.
    Pull the exact list from the most-recent prior PR
    before adding.
22. **Fire-and-forget call sites MUST have a paired
    cron-drain replay path** (Codex round 1 PR #58 P1 #3).
    PR 2's `fireAndForgetTripDispatch` will silently fail
    on POST timeout / non-2xx / missing CRON_SECRET, so
    PR 4's redispatch cron grew a "Phase B" scan that
    drains trips with `status='pending'` AND
    `current_dispatch_round_id IS NULL` AND `created_at <
    NOW() - INTERVAL '<stale_hours> hours'` AND no
    existing log row. Pattern: any time you ship a
    fire-and-forget call, ship the matching drain in the
    same PR or document it as an open item.
23. **Cron thresholds MUST be RPC arguments, not
    hard-coded `INTERVAL '… hours'` literals** (Codex
    round 1 PR #58 P2 #4). Probes that lower the threshold
    for a fast production smoke + future tuning both need
    a knob. Pattern: `RPC(p_threshold_hours NUMERIC
    DEFAULT N)` + cron route reads `*_HOURS` env (default N,
    parsed as `parseFloat` not `parseInt` so fractional
    values like `0.01` survive — Codex round 2 PR #58 P2 #4
    fix) + passes through. SQL cutoff via
    `(value::TEXT || ' hours')::INTERVAL` so fractional
    NUMERIC flows correctly. Document the env in
    `.env.example` with the probe rationale.
24. **Kill-switch flags MUST cover EVERY entry point, not
    just the originating Server Action** (Codex round 2
    PR #58 P1 #1). PR 4's `ENABLE_TRIP_AUTO_DISTRIBUTION`
    initially gated only the create-trip fire-and-forget
    POST; the redispatch cron called the dispatcher
    unconditionally so trips left pending while the flag
    was intentionally off would still get auto-dispatched
    after the stale threshold. Audit every code path that
    can reach the gated function: Server Actions, cron
    routes, internal endpoints, admin force-actions. When
    the flag is off, cron routes record a
    `success=true / error_label='skipped:flag_disabled'`
    tick and exit without touching state — never silently
    skip the tick recording (the canary needs to see the
    cron is alive even when intentionally off).
25. **Fire-and-forget drains MUST scope by the originating
    surface, not "every old row that looks pending"**
    (Codex round 2 PR #58 P1 #2). PR 4's Phase B
    initially scanned every `status='pending'` trip with
    no log row, sweeping legacy guest leads + admin
    manual queue items into the auto-dispatcher. The fix
    is two ANDed filters: `client_id IS NOT NULL`
    (excludes Phase 4 lead-promoted trips) AND
    `customer_source = 'client_portal'` (the precise PR 2
    RPC write signature; lead-promoted trips are
    `customer_source='lead'`, admin direct inserts default
    to either). Pattern: any drain pickling rows by status
    alone needs an explicit "this row was created via the
    surface I'm draining" filter — usually the same
    `customer_source` / origin discriminator the original
    write used.
26. **State-cleanup transactions that fence in a retry
    MUST roll back to a re-pickable state on retry
    failure** (Codex round 2 PR #58 P1 #3). PR 4 Phase A
    closed the stale round + NULLed
    `current_dispatch_round_id` BEFORE retrying
    auto-dispatch. If the retry returned
    `insufficient_unique_operators` /
    `no_eligible_operators` / `open_round_failed`, the
    trip stayed in `'distributed'/'offered'` with no
    active round — outside both Phase A (no open round to
    match) and Phase B (status filter excludes it) — and
    was lost forever. Fix: on any non-ok retry result OR
    exception, `UPDATE trip_requests SET status='pending'`
    so the next cron tick re-picks it via Phase B AND
    admin DispatchPanelV2 surfaces it. The state-cleanup
    writes remain correct (the old round was genuinely
    closed); restoring `pending` just keeps the trip in
    play.
27. **"Defensive against future code paths" filters can
    create the very stranding bug they were meant to
    prevent** (Codex round 3 PR #58 P1 #1). PR 4 Phase B
    initially excluded any trip with an existing
    `trip_distribution_log` row, "in case" some future
    code path wrote logs out-of-order vs. the trip status
    flip. But every Phase A failure-recovery row HAS a
    prior log row by construction, so the defensive
    filter silently re-stranded exactly the trips the
    recovery was trying to save. Lesson: when adding a
    "defensive" filter, model the actual call paths that
    can flip a row INTO the queue you're scanning —
    including recovery paths that just landed in a prior
    convention. If the defensive filter would exclude a
    legitimate recovered row, it is a stranding bug
    waiting to happen, not defence.

---

## ▶️ Resume instructions

### If you're picking this up post-CODE-COMPLETE

Phase 9 is fully merged. The remaining work is:

1. **Founder activation** — see the "Final production
   activation" panel at the top of this doc. Apply 3
   migrations + set 5 env vars + redeploy + run 22 probes
   + flip `ENABLE_TRIP_AUTO_DISTRIBUTION=true` after probes
   16 + 17 pass.
2. **Follow-up cleanup migration** (post-activation):
   `VALIDATE CONSTRAINT` on `trip_requests_client_id_clients_fkey`
   + `bookings_client_id_clients_fkey` (deferred from PR 2
   round 2 — see "Open risks / unresolved" below for why).
3. **Phase 9 closure**: archive this file to
   `aeris/docs/archive/PHASE-9-CLOSURE.md` + add summary
   section to `aeris/docs/CLAUDE-WORK-LOG.md`.

### If you're resuming PR 4 mid-flight (historical)

1. `git checkout feature/phase-9-pr-4-auto-distribution`
2. Read Phase 9 spec §3.8 (`trip_distribution_log`),
   §3.9 (CHECK extension), §4.3 (RPCs), §5 PR 4 (full
   inventory). Critical guards documented in conventions
   #14–#19 above.
3. Continue from the open todo (`git status` to see what's
   staged); validate (type-check + lint + new test) before
   each push.

### PR 4 inventory (Phase 9 spec §5 — the largest PR)

- **1 migration**
  `20260522000028_phase_9_pr_4_auto_distribution.sql`:
  - **§3.8** `trip_distribution_log` table (one row per
    `(trip × round × operator)` triple; uniqueness via
    `dispatch_target_id` per Codex round 3 P1 #2 fix)
  - **§3.9** extend
    `operator_cron_tick_history_job_name_check` with the
    4th client-cleanup name `redispatch_stale_trip_requests`
  - **§4.3** two SECURITY DEFINER RPCs
    (`score_operators_for_trip`, `auto_dispatch_trip_request`)
    + cleanup RPC (`redispatch_stale_trip_requests`)
- **`score_operators_for_trip(p_trip_request_id) → JSON`**:
  pure read; returns top-5 `[{operator_id, score, rank,
  contact_phone, …}]`. **Eligibility filter** (Codex round 3
  P1 #1): `WHERE signup_status = 'approved' AND
  contact_phone IS NOT NULL AND TRIM(contact_phone) <> ''`.
  Score formula: rating 40 / response time 30 / price 20 /
  location 10 (per CLAUDE.md "Trip Distribution Engine").
- **`auto_dispatch_trip_request(p_trip_request_id) → JSON`**:
  scoring → **phone dedupe** (Codex round 4 P2 #2: normalise
  + group by phone; keep highest-ranked; re-rank 1..N) →
  open Phase 5 dispatch round (existing
  `open_phase5_dispatch_round` reused) → INSERT
  `trip_distribution_log` rows → set
  `trip_requests.current_dispatch_round_id` → returns
  `{ok, dispatched_count, round_id, targets:[…]}`. Min
  fanout `PHASE_9_MIN_DISPATCH_FANOUT=2` (env, default 2);
  below → `{ok:false, error:'insufficient_unique_operators',
  dispatched_count:0}` + `console.error` only (no parallel
  audit table per Codex round 6 P2 #1).
- **`redispatch_stale_trip_requests`**: cron RPC scanning
  for trips that landed in `pending` more than N hours ago
  with no current_dispatch_round_id; calls
  `auto_dispatch_trip_request` for each. Records tick in
  `operator_cron_tick_history`.
- **`/api/trip-distribution/internal/dispatch` endpoint**
  (`app/api/trip-distribution/internal/dispatch/route.ts`):
  POST receiver for the PR 2 fire-and-forget helper. Auth
  via `Authorization: Bearer ${CRON_SECRET}`. Body
  `{trip_request_id, event}`. Calls
  `auto_dispatch_trip_request` synchronously; success
  logs structured row.
- **Cron route**
  `app/api/cron/client/redispatch-stale/route.ts` (every
  6h via vercel.json). Wraps the cron RPC.
- **Admin canary extension**: 5th `<ChannelHealth>` card
  for the trip-distribution channel (Phase 8 PR 2e
  pattern).
- **Tests**: 1+ test suite (likely Jest tsx for the
  scoring formula in TS mirror — pure function easy to
  pin).
- **6 founder probes (15–20)** per Phase 9 spec §6:
  - 15: scoring excludes unapproved operators
  - 16: dispatch fan-out happy path
  - 17: phone dedupe collapses correctly
  - 18: insufficient_unique_operators decline
  - 19: redispatch cron idempotency
  - 20: trip_distribution_log uniqueness on
    `dispatch_target_id`

### When PR 4 reaches Codex 100/100

1. Merge PR 4 (squash + delete branch)
2. Sync main locally
3. Update this file: PR 4 row → ✅ MERGED + merge sha
4. Phase 9 is then **CODE COMPLETE**. Founder runs final
   activation (apply PR 4 migration + flip
   `ENABLE_TRIP_AUTO_DISTRIBUTION=true` after probes 16+17
   pass) + 22-probe sweep, then closes Phase 9.

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
- **All Phase 9 code merged.** Founder activation pending —
  see "Final production activation" panel at the top of this
  doc. The 5 env vars + 3 migrations + 22-probe sweep are
  the only remaining items before Phase 9 can be formally
  closed.
- **Follow-up cleanup migration (lighter scope after PR 2
  round 3)**: post-Phase 9 activation, run `ALTER TABLE …
  VALIDATE CONSTRAINT` on both `*_client_id_clients_fkey`.
  PR 2 round 3's inline backfill already cleared every legacy
  orphan; the deferred VALIDATE is now just a
  belt-and-braces safety net. Owner: founder, after probes
  pass.

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
