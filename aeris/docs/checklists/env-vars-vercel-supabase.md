# Environment Variables — Vercel & Supabase

## Purpose

Confirm the right env vars are present, in the right scope, with the
right server-only vs client-public split, in every environment
(development, preview, production). Reminds the operator that
`SUPABASE_SERVICE_ROLE_KEY` must NEVER be exposed via `NEXT_PUBLIC_*`.

## When to run

- Before every production deploy.
- After every env rotation.
- When promoting a preview to production.
- When onboarding a new team member who needs local credentials.

## Scope rules

| Prefix | Visibility | Where to use |
|---|---|---|
| `NEXT_PUBLIC_*` | Inlined into the **client** bundle. Treat as public. | Public site URL, anon Supabase key, public WhatsApp number, public Sentry DSN. |
| `_no prefix_` (server-only) | Available only on the server (Server Components, Server Actions, Route Handlers, Edge functions). | Service role keys, Resend API key, admin password and signing secret, gateway secrets, etc. |

**Rule of thumb:** if you would not screenshot the value into Slack,
it does not get a `NEXT_PUBLIC_` prefix.

## Required matrix (Phase 1 + Phase 2 + Phase 4)

| Variable | Scope | Required in dev? | Required in preview? | Required in prod? | Notes |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | client | optional | recommended | **yes** | Used in metadata + email deep links. Must be the public URL of the deployment. |
| `NEXT_PUBLIC_SUPABASE_URL` | client | **yes** | **yes** | **yes** | Anon REST endpoint. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | **yes** | **yes** | **yes** | Public anon key — RLS protects rows. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | client | **yes** | **yes** | **yes** | Default Aeris number for the public WhatsApp CTA. Digits only, no `+`. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **yes** for lead persistence to actually work | **yes** | **yes** | **Server-only.** NEVER prefix with `NEXT_PUBLIC_`. Bypasses RLS. |
| `ADMIN_INBOX_PASSWORD` | server | **yes** for admin login | **yes** | **yes** | ≥ 16 chars; not the default; not reused. |
| `ADMIN_AUTH_SECRET` | server | **yes** for admin login | **yes** | **yes** | 32-byte hex (`openssl rand -hex 32`). |
| `RESEND_API_KEY` | server | optional | optional | recommended | Without it, founder email is a silent no-op (form still works). |
| `RESEND_FROM_EMAIL` | server | optional | optional | required-if-RESEND | Verified Resend sender on the verified domain. |
| `LEAD_NOTIFICATION_TO` | server | optional | optional | optional | Defaults to `RESEND_FROM_EMAIL` if unset. |
| `OPERATOR_TOKEN_SECRET` | server | **yes** for the operator offer URL to work | **yes** | **yes** | 32-byte hex (`openssl rand -hex 32`). **Different secret from `ADMIN_AUTH_SECRET`** — different lifecycle and blast radius. Required for `/admin/trips` dispatch to issue tokens, and for `/operator/offer/[token]` to verify them. |

Other variables in `.env.example` (`HYPERPAY_*`, `ZATCA_*`,
`INNGEST_*`, `SENTRY_*`, `UNIFONIC_*`, `FLIGHTRADAR24_API_KEY`,
`ACCUWEATHER_API_KEY`) are **not required** by Phase 1 + Phase 2 +
Phase 4 and may be left unset until the corresponding phase ships.

## Steps

### 1. Vercel — list current env vars

1. [ ] Install/login the Vercel CLI once (`npm i -g vercel` then
       `vercel login`), then link the project (`vercel link`).
2. [ ] Inspect each environment in turn:
       ```bash
       vercel env ls production
       vercel env ls preview
       vercel env ls development
       ```
       → Compare against the required matrix above. Every row marked
       **yes** in that scope must be present.

### 2. Vercel — rule audit

3. [ ] No `NEXT_PUBLIC_*` variable holds a value that should be
       secret. Specifically:
       ```bash
       vercel env ls production | grep NEXT_PUBLIC_
       ```
       → No `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
       `ADMIN_INBOX_PASSWORD`, `ADMIN_AUTH_SECRET`,
       `OPERATOR_TOKEN_SECRET`, `HYPERPAY_*`,
       `INNGEST_SIGNING_KEY`, or `SENTRY_AUTH_TOKEN` appears in
       this list. **Any of those in the public list is a P1
       incident — rotate immediately.**
4. [ ] `SUPABASE_SERVICE_ROLE_KEY` exists in **server** scope only,
       never in `NEXT_PUBLIC_`.
5. [ ] `ADMIN_INBOX_PASSWORD` and `ADMIN_AUTH_SECRET` both present
       in server scope. If either is missing, the admin layout will
       render the friendly "الإعدادات غير مكتملة" screen and the
       inbox will be unusable.

### 3. Supabase — service role

6. [ ] In Supabase → Project Settings → API, the service role key
       displayed matches the value of `SUPABASE_SERVICE_ROLE_KEY`
       in the Vercel **production** scope. (You do not need to copy
       — just confirm the last 4 chars match what `vercel env pull`
       gives you.)
7. [ ] Confirm the anon key in the same Supabase page matches the
       `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel production.

### 4. Local development setup (founder + new contributors)

8. [ ] On a fresh laptop:
       ```bash
       cd aeris
       cp .env.example .env.local
       ```
9. [ ] Fill in the **required** values for development scope from
       the matrix above. Skip the optional ones.
10. [ ] Generate `ADMIN_AUTH_SECRET` locally:
        ```bash
        openssl rand -hex 32
        ```
        Paste into `.env.local`. **Do not** reuse the production value.
11. [ ] Pick a strong `ADMIN_INBOX_PASSWORD` (≥ 16 chars). Local
        only — distinct from production.
12. [ ] `npm run dev` boots cleanly. `/admin/login` accepts the local
        password and lands on `/admin/leads`.

### 5. Rotation drill (do once per quarter)

13. [ ] Rotate `ADMIN_AUTH_SECRET` in Vercel production:
        ```bash
        vercel env rm ADMIN_AUTH_SECRET production
        vercel env add ADMIN_AUTH_SECRET production
        # Paste the output of: openssl rand -hex 32
        ```
        Trigger a redeploy.
        → All existing admin sessions are invalidated (HMAC mismatch).
        Sign in again to confirm the new value works.
14. [ ] Repeat for `ADMIN_INBOX_PASSWORD` if it has been shared
        beyond the founder, is older than 90 days, or ever appeared
        in a screenshot or screenshare.
15. [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY` if it has ever left a
        trusted machine. Use Supabase → Project Settings → API →
        "Reset" — then update Vercel and redeploy. (Brief read/write
        outage during the cutover; do this off-peak.)

## Pass criteria

- Every required variable from the matrix is present in the right
  scope in production (and preview if the team uses preview deploys).
- No secret-shaped variable carries a `NEXT_PUBLIC_` prefix.
- Supabase API page values match the Vercel env values for both keys.
- Local `.env.local` boots `npm run dev` cleanly and the admin
  login works.

## If it fails

- **A required production var is missing:**
  - Add it via `vercel env add <NAME> production` and redeploy.
  - Re-run section 1.
- **A secret has `NEXT_PUBLIC_` prefix:**
  - **Treat as P1.** Rotate that secret first (the value is already
    in the client bundle and may be in CDN caches). Then remove the
    `NEXT_PUBLIC_` variant, add the secret in server scope, redeploy.
  - File the incident in deploy notes.
- **Anon key mismatch (Vercel vs Supabase):**
  - The Vercel value is stale. Pull the current value from Supabase
    → Project Settings → API → `anon` → and update Vercel. Redeploy.
- **`/admin/login` shows "الإعدادات غير مكتملة" instead of the
  password form:**
  - `ADMIN_INBOX_PASSWORD` or `ADMIN_AUTH_SECRET` is missing or
    empty in that environment. Add them and redeploy.
- **Local `npm run dev` works but admin login fails locally:**
  - `.env.local` has the var spelled differently (case-sensitive),
    or has trailing whitespace, or uses a smart-quote when copied
    from a doc. Re-paste with a plain editor.
