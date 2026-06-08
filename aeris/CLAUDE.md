# CLAUDE.md — Aeris Project Context

> Auto-loaded by Claude Code. Describes the project **as it actually is today**, not the original plan. Keep it in sync with reality when things change.

---

## 🎯 What Aeris is

A two-sided **private-aviation marketplace** for Saudi Arabia / GCC, connecting **clients**, **operators** (charter companies / aircraft owners), and the **Aeris admin** team. Arabic-first (RTL).

**Five service lines:**
1. **Charter** — request → admin dispatch → operator offers → client accepts → booking.
2. **Empty Legs** — operator-published discounted return legs + a Dutch-auction price tick.
3. **Privilege** — 4-tier loyalty (Silver/Gold/Platinum/Diamond) + cashback ledger.
4. **MedEvac + Aeris Shield** — medical-evacuation requests + a coverage subscription.
5. **Cargo** — specialized cargo (horses, luxury cars, valuables).

Plus: referrals, reviews, support tickets, admin analytics.

**Current status (2026-06):** Cargo + MedEvac are **live in prod**. The **payment core + client checkout UI are built but OFF** behind `ENABLE_PAYMENTS` (HyperPay COPYandPAY; live creds + webhook verifier still pending). **ZATCA e-invoicing, operator payouts, refunds, and Moyasar are DEFERRED** (not built). Money is collected **offline today** (admin issues a signed checkout link → client confirms add-ons → bank transfer / WhatsApp).

---

## 🛠️ Tech stack (actual)

- **Next.js 16 (App Router) + React 19**, TypeScript **strict** (honored — no `any`/`@ts-ignore`/TODO in prod code). The Next 16 `middleware`→`proxy` rename is in use (`proxy.ts`).
- **Server Components by default**; mutations via **Server Actions** in `app/actions/`; `'use client'` only where needed; `'server-only'` guards on server libs.
- **TailwindCSS** with a custom navy/gold/ink theme (see Design tokens); **Zod** for validation (`lib/validators/`, `lib/*/validators/`).
- **Supabase** Postgres + **PostgREST**. Hosting: **Vercel** (+ Vercel Cron). Email: **Resend**. WhatsApp: **wasenderapi** (transactional) + `wa.me` deep-links.

> **Wired:** Sentry error monitoring (`instrumentation.ts`, `sentry.server/edge.config.ts`, `instrumentation-client.ts`, `lib/monitoring/*`; fully a no-op until a DSN is set — see `.env.example`).
> **NOT in use (don't assume):** Supabase Auth (we roll our own — see below), `shadcn`/Radix, Unifonic SMS (env exists, no call sites). There is **no standard test runner** — tests are hand-rolled `tsx` scripts auto-discovered by `scripts/run-unit-tests.mjs`; CI runs **all** `test:*` unit suites + `audit:db`.

---

## 🔐 Auth & data-access model (READ THIS FIRST — most-misunderstood part)

**There is exactly ONE Supabase client: the service-role admin client (`lib/supabase/admin.ts`). No anon/browser Supabase client exists.** We do **not** use Supabase Auth.

- **Three custom session systems**, each cookie-based with `sha256(token)` stored in DB:
  - **Client** — `lib/clients/auth.ts` → `requireClientSession()` → `client_id`.
  - **Admin** — password + **TOTP MFA** + login rate-limiting + founder-seed bootstrap (`lib/admin/...`) → `requireAdminSession()`.
  - **Operator** — OTP + welcome/password-reset tokens + sessions (`lib/operators/auth.ts`) → `requireOperatorSession()` (+ `password_must_change` lockdown).
  - Mid-session revoke/suspend is honored on the next request for all three.
- **Every table has RLS enabled with NO permissive anon/authenticated policy** (deny-all; only `airports` is public-readable). All writes/reads go through **`SECURITY DEFINER` service-role-only RPCs**: each ends with `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`. Identity (client/operator id) is passed from the validated session, never trusted from input; RPCs enforce ownership.
- **Loose-client pattern:** `types/database.ts` is **hand-maintained and lags** the live schema, so new tables/columns are accessed via `createAdminClient() as unknown as SupabaseClient` (or a local `Loose*` type). This is intentional; the compensating control is the DB-compat checker.
- **DB-compat CI gate (`npm run audit:db`):** `scripts/audit-columns.cjs` statically checks every `.from/.rpc/.select/.eq/.insert/.update` against the committed snapshot `reports/live-schema-compact.json`. **Refresh the snapshot after each prod apply** (`npm run introspect:db`, which reads the service-role key over PostgREST — no DB password). A PR that adds DB objects makes `audit:db` RED until the migration is applied + snapshot refreshed — this enforces apply-before-merge.

---

## 🗄️ Migrations (forward-only)

- Live in `supabase/migrations/`, sequentially numbered, **forward-only** (no down files), **idempotent** (`IF NOT EXISTS`, `CREATE OR REPLACE`). New functions are `SECURITY DEFINER` + `SET search_path = public` + REVOKE/GRANT. New tables are RLS deny-all.
- **Never `supabase db push`** (migrations 000001+ were applied via raw `pg`, not tracked in the CLI). Apply to **prod** via the runner in `D:\Plan\migration-runner` over the **session pooler** `aws-1-eu-central-1.pooler.supabase.com` (founder types the DB password interactively). Then refresh the snapshot + commit it.
- Discipline: a migration/PR reaches **Codex 100/100** before the founder accepts; apply-to-prod only on the founder's explicit «طبّق ثم ادمج».

---

## 💳 Bookings & payment state

- `bookings.payment_status` (**financial**, ENUM) is separate from `flight_status` (**operational**). New bookings default to **`pending_offline`**; `paid` flips via `confirm_booking_payment` (which cascades cashback-award + tier-eval triggers + the referral cron). A booking is immutable after `paid` (trigger guard).
- Payment core = migration `..._payment_core.sql` + `lib/payments/{provider,hyperpay,payments}.ts` + `app/actions/payments.ts` (gateway-agnostic; HyperPay COPYandPAY hosted widget — **no card data on our servers**; status-lookup is the source of truth; the webhook is **fail-closed** until a real verifier is wired). All behind `ENABLE_PAYMENTS` (off).

---

## 🎛️ Feature flags (fail-closed `=== 'true'` unless noted)

`ENABLE_CLIENT_PORTAL` (the `/me` tree) · `ENABLE_OPERATOR_PORTAL` (⚠️ page-render gates use `=== 'false'` → **fail-OPEN**; the Server Actions are fail-closed — set it to `true` for a working portal) · `ENABLE_CARGO` (live) · `ENABLE_MEDEVAC` (live) · `ENABLE_PRIVILEGE` · `ENABLE_PAYMENTS` (off) · `ENABLE_TRIP_AUTO_DISTRIBUTION` (off → trips wait for manual admin dispatch) · `ENABLE_EMPTY_LEGS_{PUBLIC_MARKETPLACE,NOTIFICATIONS,ADMIN_UI}` · `ENABLE_CLIENT_EMPTY_LEGS_PORTAL` · `PHASE5_ADMIN_UI` (multi-operator dispatch) · `ENABLE_OPERATOR_LEGACY_TOKEN`. Each gated surface also needs its per-token HMAC secret (fail-closed if missing). Referrals / reviews / support are **not** flag-gated.

---

## 🌍 i18n / RTL / formatting

- Arabic dictionaries in `lib/i18n/*-ar.ts` (e.g. `clientsAr`); error codes → Arabic via `clientErrorMessage(code)` (`components/clients/error-banner.tsx`). No English locale yet.
- `<html lang="ar" dir="rtl">`. Use logical Tailwind classes: `ms-`/`me-`/`ps-`/`pe-`/`text-start`/`text-end` (never `ml`/`pr`/`text-left`). Currency = SAR shown as "ريال" (use `formatSARLabel` / `clientsAr.currencySAR`, not a hardcoded string). **Western digits** (1,2,3). Timezone **Asia/Riyadh**.

---

## 🎨 Design tokens (Tailwind)

`navy` (`DEFAULT/secondary/tertiary/card`), `gold` (`DEFAULT/light/dark`), `ink` (`primary/secondary/muted`), `border`. Font: `font-ar` (IBM Plex Sans Arabic). Luxury navy/gold aesthetic; mobile-first.

---

## 🔁 Async / notifications / crons

- Outbox + cron pattern: events land in `*_outbox` tables; cron routes under `app/api/cron/*` drain them with `FOR UPDATE SKIP LOCKED` + idempotent guards. Cron auth = `Authorization: Bearer $CRON_SECRET` (constant-time compare). Schedules in `vercel.json`.
- Notifications fail-soft (no-op when unconfigured). Charter dispatch to operators is a **tokenized `/operator/offer/[token]` link** sent over WhatsApp (manual paste by admin), **not** an in-portal inbox.

---

## 📐 Conventions

- **Offers live in multiple tables:** `phase4_operator_offers` (single-op) + `phase5_operator_offers` (dispatch rounds) for charter, `cargo_offers`, `medevac_offers`. `lib/supabase/queries/unified-offers.ts` merges phase4+phase5 for display. Phase-numbered names are historical.
- Files **kebab-case**, components **PascalCase**, constants **UPPER_SNAKE**, tables **snake_case**.
- **Comments only for WHY** (business rule, workaround, security) — never restate WHAT.
- Validate all input with Zod. Add `audit_logs` rows for sensitive admin/PII reads (medevac patient data + privilege detail are audit-first).

---

## 🧪 Quality gates

`npm run type-check` · `npm run lint:strict` (`--max-warnings 0`) · `npm run build` · `npm run audit:db`. CI (`.github/workflows/ci.yml`, at the **git root**, not `aeris/`) runs these + **all** `test:*` unit suites (auto-discovered by `scripts/run-unit-tests.mjs`). Local Turbopack `next build` fails inside a git worktree with a `node_modules` junction (env-only) — rely on CI for the build there.

---

**Last updated:** 2026-06 — reflects Next 16, the 5 live/built service lines, custom-auth + service-role-RPC model, and the built-but-off payment phase (PR1 + checkout UI + cashback-at-checkout).
