# ✈️ Aeris — Smart Private Aviation Platform

> منصة ذكية متكاملة للطيران الخاص في المملكة العربية السعودية — سوق ثنائي الجانب يربط العملاء بالمشغّلين وفريق Aeris.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript (strict) + TailwindCSS + Supabase (Postgres/PostgREST). Arabic-first (RTL). Hosting: Vercel.

> Full engineering context for contributors (and Claude Code) lives in **[`CLAUDE.md`](CLAUDE.md)** — read it first; it documents the auth/data-access model, migration discipline, and the feature-flag map.

---

## 🧩 Service lines

| Line | What | Status |
|---|---|---|
| **Charter** | request → admin dispatch → operator offers → client accepts → booking | ✅ built |
| **Empty Legs** | operator-published discounted legs + Dutch-auction price tick | ✅ built (some surfaces flag-gated) |
| **Privilege** | 4-tier loyalty + cashback ledger | ✅ built (`ENABLE_PRIVILEGE`) |
| **MedEvac + Shield** | medevac requests + coverage subscription | ✅ **live in prod** |
| **Cargo** | horses / luxury cars / valuables | ✅ **live in prod** |
| Payments | HyperPay COPYandPAY checkout (core + client UI + cashback-at-checkout) | 🚧 **built, OFF** (`ENABLE_PAYMENTS`; needs live creds + webhook verifier) |
| ZATCA · payouts · refunds · Moyasar | tax/settlement layer | ⏸️ **deferred** (not built) |

Money is collected **offline today**: admin issues a signed checkout link → client confirms add-ons → bank transfer / WhatsApp.

---

## 🚀 Quick start (local)

```bash
cd aeris
npm install
cp .env.example .env.local   # then fill values (see CLAUDE.md flag/secret notes)
npm run dev                  # http://localhost:3000
```

**Notes that differ from a vanilla Supabase app:**
- **Auth is custom** (not Supabase Auth) — three cookie-session systems (client/admin/operator). The only Supabase client is the **service-role** admin client; there is no anon/browser client.
- **`types/database.ts` is hand-maintained** (the `db:types` script still points at a `YOUR_PROJECT_ID` placeholder). New tables/columns are reached via the loose-client pattern; the `audit:db` gate guards drift.
- **Migrations** in `supabase/migrations/` are forward-only/idempotent and applied to prod via the runner in `D:\Plan\migration-runner` over the session pooler (**never `supabase db push`**). After applying, run `npm run introspect:db` and commit the refreshed `reports/live-schema-compact.json`.
- **Feature flags** are fail-closed (`=== 'true'`). Most customer surfaces are off by default — see the flag map in `CLAUDE.md`. For a full local/demo run you must set them explicitly (e.g. `ENABLE_CLIENT_PORTAL`, `ENABLE_OPERATOR_PORTAL=true`, `ENABLE_PRIVILEGE`, empty-legs flags) plus each surface's HMAC secret.
- **Admin bootstrap:** set `ADMIN_FOUNDER_EMAIL` + `ADMIN_INBOX_PASSWORD` + `ADMIN_AUTH_SECRET`, then log in at `/admin/login` — the founder row is auto-seeded once (then you must set a new password + can enroll MFA).

---

## 📁 Structure

```
aeris/
├── app/
│   ├── (public)/            # marketing, /request lead form, /signup, /login, public empty-legs
│   ├── (client)/me/         # authenticated client portal
│   ├── (admin)/admin/        # admin panel (login + (protected) group)
│   ├── (checkout)/           # tokenized offline checkout-prep
│   ├── operator/             # operator portal (authed) + tokenized /operator/offer/[token]
│   └── api/                  # webhooks + cron routes
├── components/               # UI (clients/ admin/ operator/ privilege/ cargo/ medevac/ ...)
├── lib/                      # auth, queries, payments, notifications, privilege, i18n, validators
├── supabase/migrations/      # forward-only SQL migrations
├── scripts/                  # audit-columns.cjs (audit:db) + live-introspect.cjs (introspect:db)
├── reports/                  # live-schema-compact.json (DB-compat snapshot)
└── types/database.ts         # hand-maintained DB types (loose-client pattern fills the gaps)
```

---

## 🛠️ Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run start          # run production build
npm run type-check     # tsc --noEmit
npm run lint:strict    # eslint . --max-warnings 0  (CI gate)
npm run audit:db       # app↔live-schema compatibility gate (CI)
npm run introspect:db  # refresh reports/live-schema-compact.json from live schema (service-role key)
```

---

## 🎨 Design tokens

Use Tailwind theme tokens (don't hardcode hex): `navy` (`DEFAULT/secondary/tertiary/card`), `gold` (`DEFAULT/light/dark`), `ink` (`primary/secondary/muted`), `border`. Arabic font: `font-ar` (IBM Plex Sans Arabic). RTL-first — use logical classes (`ms-`/`me-`/`text-start`), Western digits, currency "ريال".

---

## 🔐 Security checklist

- [ ] Never commit `.env.local` (gitignored — holds the service-role key + admin bootstrap).
- [ ] Validate all input with Zod.
- [ ] New tables: RLS deny-all; new RPCs: `SECURITY DEFINER` + `search_path` + REVOKE anon/authenticated + GRANT service_role only.
- [ ] Enforce ownership inside RPCs (identity from the session, never from input).
- [ ] Webhooks verify signatures (payment webhook is fail-closed until its verifier lands).
- [ ] Audit-log sensitive admin/PII reads.

---

## ✅ Production checklists

Manual operational lists run before every production deploy. Index:
[`docs/checklists/README.md`](docs/checklists/README.md). Each follows
Purpose → When to run → Steps → Pass criteria → If it fails.

- [`production-readiness.md`](docs/checklists/production-readiness.md) — master pre-deploy gate.
- [`ci-pipeline.md`](docs/checklists/ci-pipeline.md) — GitHub Actions shape, no-secrets discipline, green `main`.
- [`supabase-migration-verification.md`](docs/checklists/supabase-migration-verification.md) — enums/columns/indexes/RLS-on/anon-denied probes.
- [`env-vars-vercel-supabase.md`](docs/checklists/env-vars-vercel-supabase.md) — required/optional matrix + scopes.
- [`security-hardening.md`](docs/checklists/security-hardening.md) — secret scan, RLS coverage, cookie flags, incident response.
- (+ admin-inbox, operator-flow, pwa-audit, resend-email smoke tests.)

For demoing to partners, see **[`docs/PARTNER-DEMO-RUNBOOK.md`](docs/PARTNER-DEMO-RUNBOOK.md)**.

---

## 🌍 Deployment

Vercel (push → import → set env vars → deploy); custom domain `aeris.sa`. Requires Vercel Pro (the cron schedule in `vercel.json` exceeds Hobby limits).

## 📞 Support
WhatsApp **+966558048004** · support@aeris.sa

## 📝 License
Proprietary — All rights reserved © 2026 Aeris
