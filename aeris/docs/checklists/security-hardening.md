# Security Hardening

## Purpose

Verify that no real secrets are in the repo, RLS is correctly applied
across the schema, the admin inbox is locked down, no PII leaks
through public surfaces, and there is a known incident-response path.

## When to run

- Before every production deploy.
- Quarterly full review.
- After any incident.
- After any change to `lib/admin/*`, `supabase/migrations/*`,
  `middleware.*` (if added later), or any new public route.

## Steps

### 1. Secrets — repository scan

Patterns are tight enough that the placeholders in `.env.example`
(`re_xxxxxxxxxxxx`, `eyJxxxxxxxxxxx`, `sk-ant-xxxxxxxxxxxx`, etc.)
must **not** match. If a placeholder ever does match, treat it as a
planning error and tighten the pattern — do not allow-list the file.

**bash / git-bash:**

```bash
cd aeris
grep -RIE \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude=package-lock.json \
  -e 'sk-ant-[A-Za-z0-9_-]{30,}' \
  -e 're_[A-Za-z0-9]{30,}' \
  -e 'eyJ[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' \
  .
```

**PowerShell:**

```powershell
Set-Location aeris
Get-ChildItem -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.next\\|package-lock\.json' } |
  Select-String -Pattern 'sk-ant-[A-Za-z0-9_-]{30,}|re_[A-Za-z0-9]{30,}|eyJ[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
```

1. [ ] Run one of the commands above. → **Zero matches.** Any match
       is treated as a real secret — investigate, rotate, and
       remove from git history if it was committed.
2. [ ] Manually scan `.env.example` for any value that does **not**
       look like a placeholder (no `xxxxxxxxxxx`, `YOUR_PROJECT`, or
       similar). → Every value is clearly a placeholder.

### 2. Row Level Security

3. [ ] All tables created by `supabase/migrations/*.sql` have
       `relrowsecurity = true`:
       ```sql
       SELECT relname, relrowsecurity
       FROM pg_class
       WHERE relkind = 'r'
         AND relnamespace = (
           SELECT oid FROM pg_namespace WHERE nspname = 'public'
         )
       ORDER BY relname;
       ```
       → Every public table shows `t` in the second column.
4. [ ] `lead_inquiries` has **zero** policies:
       ```sql
       SELECT count(*) FROM pg_policies
       WHERE tablename = 'lead_inquiries';
       ```
       → `0`. Anon and authenticated cannot SELECT/INSERT/UPDATE/DELETE.
       Only the service role (used server-side) can read or write.
5. [ ] **Existing Phase 1/2 tables that are not yet exposed via UI
       or API may also be deny-all (RLS on, no policies for anon /
       authenticated). This is expected and safe today; do not flag
       it as a finding.** The current explicit-policy set lives in
       `supabase/migrations/20260422000001_initial_schema.sql` —
       only `users`, `bookings`, `trip_requests`, `empty_legs`,
       `notifications`, and `airports` have policies; the other
       tables are intentionally deny-all because their UI/API has
       not shipped.
6. [ ] **Future feature tables MUST get explicit, audited policies
       before their UI/API ships.** If any Phase 4+ change exposes a
       previously-internal table, the same migration that exposes it
       must add the appropriate `CREATE POLICY` statements, and this
       checklist must be re-run before deploy.

For the full anon-vs-service-role probe, see
[supabase-migration-verification.md](supabase-migration-verification.md)
section 4.

### 3. Admin password + signing secret

7. [ ] `ADMIN_INBOX_PASSWORD` (production env in Vercel):
       - Length ≥ 16 characters.
       - Not the placeholder default.
       - Not reused from any external service (Gmail, GitHub,
         personal accounts).
       - Stored only in a password manager + Vercel env. No copies in
         chat, email, or screenshots.
8. [ ] `ADMIN_AUTH_SECRET` (production env in Vercel):
       - Generated freshly with `openssl rand -hex 32` (64 hex chars).
       - Different from the development and preview values.
       - **Rotated** if it ever left a trusted machine, was pasted
         into a screenshare, or appears in any external system.

### 4. Admin route discipline

9. [ ] `npm run build` output: every admin route is `ƒ Dynamic`,
        none are `○ Static`:
        ```
        ƒ /admin/leads
        ƒ /admin/leads/[id]
        ƒ /admin/login
        ```
        → Matches Phase 2 acceptance criterion #7. If any admin
        route is `○ Static`, PII would be cached at the edge —
        treat as a P1 finding.

### 5. No public PII leakage

10. [ ] As an unauthenticated client, fetch the protected admin URL
        and confirm it does not leak data:
        ```bash
        curl -sI https://aeris.sa/admin/leads
        ```
        → Status `307` or `308` redirect to `/admin/login`. No
        `Set-Cookie` containing PII. No body content with names,
        phones, or notes.
11. [ ] As an unauthenticated client, fetch the public homepage and
        confirm no admin-only data appears in the HTML:
        ```bash
        curl -s https://aeris.sa/ | grep -iE 'lead_inquiries|customer_phone|internal_notes'
        ```
        → No matches. (If anything matches, an admin component
        leaked into the public bundle — investigate immediately.)

### 6. Cookie + transport hardening

12. [ ] After admin login, inspect the `aeris_admin` cookie:
        - `HttpOnly = true`
        - `SameSite = Lax`
        - `Path = /admin`
        - `Secure = true` on production HTTPS, `Secure = false` on
          local HTTP (intentional — Phase 2 plan).
        - `Max-Age` ≈ 7 days.
13. [ ] HTTPS is enforced by Vercel (default). Confirm the response
        carries Vercel's `Strict-Transport-Security` header:
        ```bash
        curl -sI https://aeris.sa/ | grep -i strict-transport-security
        ```
        → Header is present.
14. [ ] Honeypot field still ships in the public flight request
        form. Open `<host>/request`, view the page source, and
        search for `name="hp_company"` → it exists, inside a
        visually-hidden wrapper.

### 7. Incident response (read-and-acknowledge)

15. [ ] **Revoke all active admin sessions immediately.** Rotate
        `ADMIN_AUTH_SECRET` in Vercel and redeploy. Every issued
        cookie's HMAC fails verification on the next request.
16. [ ] **Revoke the Supabase service role key.** Supabase →
        Project Settings → API → Reset service role key. Update
        Vercel env and redeploy. Brief outage on lead persistence
        during the cutover; expected.
17. [ ] **Disable the admin inbox in an emergency.** Unset
        `ADMIN_INBOX_PASSWORD` in Vercel production and redeploy.
        The friendly "الإعدادات غير مكتملة" screen will render at
        every protected admin URL — no login is possible until the
        var is restored.
18. [ ] **A real secret was committed to git history.** Rotate the
        secret first (above), then purge from history with `git
        filter-repo` (preferred) or BFG, force-push the rewritten
        history, and notify everyone with a clone to re-clone fresh.

## Pass criteria

- Section 1: zero matches from the secret-scan command.
- Section 2: every public table has RLS on; `lead_inquiries` has
  zero policies; the deny-all stance on not-yet-exposed tables is
  acknowledged as intentional.
- Section 3: admin password ≥ 16 chars, not the default, not reused;
  signing secret freshly generated and rotated when needed.
- Section 4: every admin route is `ƒ Dynamic` in the build output.
- Section 5: unauthenticated curl to admin URLs returns 307/308 with
  no PII; public homepage HTML contains no admin-only identifiers.
- Section 6: cookie flags as specified; HSTS present; honeypot still
  shipping.
- Section 7: each incident-response step is understood and reachable
  by the person on call.

## If it fails

- **Section 1 finds a secret in the repo:**
  - Treat as P1. Rotate the secret immediately (Supabase API page,
    Resend dashboard, etc.). Remove from history. Force-push.
- **Section 2 step 4 finds non-zero policies on `lead_inquiries`:**
  - Drop the unwanted policy:
    `DROP POLICY "<name>" ON lead_inquiries;`
  - Investigate who/what added it.
- **Section 4 finds a `○ Static` admin route:**
  - Confirm the affected file exports
    `export const dynamic = 'force-dynamic'` and
    `export const revalidate = 0`. Phase 2 plan required this on
    every admin route + the `(protected)` layout.
- **Section 5 step 10 returns 200 instead of a redirect:**
  - Critical. The `(protected)` layout is not running
    `requireAdminSession()` correctly. Inspect
    `app/(admin)/admin/(protected)/layout.tsx`.
- **Section 5 step 11 finds PII identifiers in public HTML:**
  - Critical. An admin component or admin query was imported into a
    public route. Find the import path and remove it.
- **Section 6 finds `Secure = false` on production:**
  - Inspect `lib/admin/auth.ts → getAdminCookieOptions()`. The
    `secure` flag must be tied to `process.env.NODE_ENV === 'production'`.
