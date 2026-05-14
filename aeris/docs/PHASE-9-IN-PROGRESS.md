# Phase 9 — In Progress

> Current-state doc for resuming Phase 9 work in a new
> Claude session. Updated as each PR moves through Codex
> review → merge → activation. Read this file FIRST when
> resuming; it tells you exactly where we are and what to
> do next.

---

## 📍 Current state (last updated: PR 1 round 4 fix)

| Field | Value |
|---|---|
| **Active PR** | [#55 — Phase 9 PR 1 Client Auth](https://github.com/alharbib902-del/plan/pull/55) |
| **Branch** | `feature/phase-9-pr-1-client-auth` |
| **Code HEAD** | `3d55632` (Codex round 4 P2 #1 fix — reset RPC bcrypt format) |
| **Status** | ⏳ Awaiting Codex round 5 review |
| **Last action** | Round 4 fix (1x P2) pushed at `3d55632` |
| **Next action** | Codex round 5 review → iterate or merge |

> **Note on `Code HEAD` vs `git log` tip:** the row above
> records the last *code* commit. Each update to this
> resume-doc itself produces an additional commit on the
> branch (one of `bc0384d`/`f65c7c1`/`031636a`/this one),
> so `git rev-parse HEAD` may be one commit ahead of `Code
> HEAD`. The doc-only commits never change product
> behaviour; Codex review still applies to `Code HEAD`.
> See Codex round 3 PR #55 P2 #2 for the rationale.

---

## 🗺️ PR sequence

| # | PR | Status | sha | Notes |
|---|---|---|---|---|
| Spec | [#54](https://github.com/alharbib902-del/plan/pull/54) | ✅ MERGED | `62873b0` | 7 Codex rounds → 100/100 |
| **PR 1** | [#55](https://github.com/alharbib902-del/plan/pull/55) | 🟡 OPEN | `3d55632` | Client auth (32 files, 26 tests) |
| PR 2 | — | ⏳ pending | — | Charter form (~250 lines) |
| PR 3 | — | ⏳ pending | — | Client portal (~600 lines) |
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

---

## ▶️ Resume instructions

### If PR #55 review is back

Send the Codex findings to me as a code block. I'll
apply the fixes, validate, and push as a new commit on
the same branch.

### If PR #55 is accepted 100/100

1. Merge PR #55 (squash + delete branch)
2. Sync main locally
3. Update this file: change PR 1 row to ✅ MERGED with the
   merge sha
4. Update Active PR row to PR 2
5. Begin **PR 2: Authenticated charter form** per
   Phase 9 spec §5 PR 2 inventory:
   - 1 migration (`create_authenticated_trip_request` RPC)
   - 1 page `/(client)/me/charter`
   - 1 component `charter-form.tsx`
   - 2 Server Actions (`createAuthenticatedTripRequest`,
     `cancelMyTripRequest` — with status guard per spec
     round 4 P1 #1)
   - Validators extended (`createTripRequestSchema`,
     `cancelTripRequestSchema`)
   - 1 test suite
   - Auto-dispatch trigger gated by
     `ENABLE_TRIP_AUTO_DISTRIBUTION === 'true'` (default
     false until PR 4 + Probes 16 + 17 pass)

### If PR #55 was merged but production not yet activated

Founder needs to:
1. Run migration in Supabase:
   `20260520000026_phase_9_pr_1_client_auth.sql`
2. Set Vercel env vars (Production + Preview):
   - `ENABLE_CLIENT_PORTAL=true`
   - `CLIENT_PASSWORD_RESET_TOKEN_SECRET=<openssl rand -hex 32>`
3. Redeploy
4. Run the 9 PR 1 probes (1, 2, 3, 3-shape, 4, 4-canary,
   5, 6, 7) per Phase 9 spec §6

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

None known at this point. All Codex round 1 + 2 + 3 + 4
findings addressed (4 + 3 + 1 + 1 = 9 total: 3 P1 + 6 P2).
Next blocking step is the round 5 review.

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
