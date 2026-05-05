# ✈️ Aeris — Smart Private Aviation Platform

> منصة ذكية متكاملة للطيران الخاص في المملكة العربية السعودية

**Target Launch:** 60 days from kickoff
**Tech Stack:** Next.js 14 + Supabase + TypeScript + Tailwind

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- npm 10+
- Supabase account
- Claude Code Opus 4.7 Max subscription

### Setup Steps

#### 1. Clone & Install
```bash
cd D:/Plan/aeris
npm install
```

#### 2. Environment Variables
```bash
cp .env.example .env.local
# Fill in the values from your service accounts
```

#### 3. Database Setup
1. Create a Supabase project at https://supabase.com
2. Copy your project URL and anon key to `.env.local`
3. Run the migrations in order via Supabase Dashboard → SQL Editor:
   - `supabase/migrations/20260422000001_initial_schema.sql`
   - `supabase/migrations/20260425000002_lead_inquiries.sql` (Phase 2 — guest leads + admin inbox)

#### 4. Generate TypeScript Types
```bash
# Install Supabase CLI first (one time)
npm install -g supabase

# Login
supabase login

# Generate types (replace YOUR_PROJECT_ID)
supabase gen types typescript --project-id YOUR_PROJECT_ID > types/database.ts
```

#### 5. Admin Inbox (Phase 2)

For local access to `/admin/leads` set both env vars in `.env.local`:

```bash
ADMIN_INBOX_PASSWORD=pick-any-strong-password
ADMIN_AUTH_SECRET=$(openssl rand -hex 32)
```

Optionally enable founder email notifications when a new lead lands:

```bash
RESEND_API_KEY=re_xxxx
RESEND_FROM_EMAIL=noreply@aeris.sa
LEAD_NOTIFICATION_TO=you@example.com  # falls back to RESEND_FROM_EMAIL
```

`/admin/login` is the only public admin route. Everything under `/admin/leads` is gated by a signed HttpOnly cookie (7-day expiry) and protected at both the layout and Server Action level.

#### 6. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) 🎉

---

## 📁 Project Structure

```
aeris/
├── app/                      # Next.js 14 App Router
│   ├── (auth)/              # Authentication pages
│   ├── (client)/            # Customer-facing pages
│   ├── operator/            # Operator portal
│   ├── admin/               # Admin panel
│   └── api/                 # API routes
├── components/              # React components
├── lib/                     # Business logic
│   ├── supabase/           # Database clients
│   ├── hyperpay/           # Payment integration
│   ├── zatca/              # E-invoicing
│   ├── notifications/      # Email/SMS
│   ├── automation/         # Inngest workflows
│   └── utils/              # Helpers
├── types/                   # TypeScript types
├── supabase/
│   └── migrations/         # SQL migrations
└── CLAUDE.md               # Claude Code context
```

---

## 🛠️ Development Commands

```bash
# Development
npm run dev              # Start dev server

# Build
npm run build            # Production build
npm run start            # Run production server

# Quality
npm run lint             # Lint code
npm run type-check       # Check TypeScript
npm run format           # Format with Prettier

# Database
npm run db:types         # Regenerate types from Supabase
```

---

## 🎨 Design System

### Colors
- **Gold:** `#C9A961` (primary)
- **Navy:** `#0A1628` (background)
- **Ink:** `#FAFAFA` (text)

### Fonts
- **Arabic:** IBM Plex Sans Arabic
- **English Display:** Playfair Display
- **English Body:** Inter

### Usage
Always use Tailwind theme tokens:
```tsx
<div className="bg-navy text-ink border-gold/20">
  <h1 className="text-gold font-display">Title</h1>
</div>
```

---

## 🔐 Security Checklist

- [ ] Never commit `.env.local`
- [ ] Always validate input with Zod
- [ ] Use Row Level Security (RLS) on all tables
- [ ] Use parameterized queries (Supabase handles automatically)
- [ ] Admin routes check role before execution
- [ ] Webhooks verify signatures

---

## 📚 Key Documents

- **`CLAUDE.md`** — Full project context for Claude Code
- **`D:/Plan/advisor-doc/`** — Business study documents
- **`supabase/migrations/`** — Database schema

---

## ✅ Production Checklists

Manual operational lists run before every production deploy. Index:
[`docs/checklists/README.md`](docs/checklists/README.md). Each list
follows the same shape (Purpose → When to run → Steps → Pass criteria
→ If it fails) so it can be executed top-to-bottom.

- [`production-readiness.md`](docs/checklists/production-readiness.md) — master pre-deploy gate; aggregates the others.
- [`ci-pipeline.md`](docs/checklists/ci-pipeline.md) — GitHub Actions workflow shape (triggers, Node 20, `npm ci`, type-check, build, `lint:strict`), no-secrets discipline, branch protection, and a green `main`.
- [`admin-inbox-smoke-test.md`](docs/checklists/admin-inbox-smoke-test.md) — login, list, detail, status, notes, sign-out, cookie-tamper UI check, Phase 4 promote button.
- [`operator-flow-smoke-test.md`](docs/checklists/operator-flow-smoke-test.md) — Phase 4 end-to-end (promote → dispatch → operator submits → admin accepts), with race-guard / expired-offer / tampered-token probes.
- [`pwa-audit.md`](docs/checklists/pwa-audit.md) — Phase 4.2 PWA installability audit: manifest, service worker, `beforeinstallprompt`, offline behavior. No Lighthouse score required. Regenerate icons via `npm run generate:icons` from `public/icons/icon-source.svg`.
- [`supabase-migration-verification.md`](docs/checklists/supabase-migration-verification.md) — enums, columns, indexes, trigger, RLS on, zero policies on `lead_inquiries`, anon REST probes denied.
- [`resend-email-test.md`](docs/checklists/resend-email-test.md) — founder notification email: valid key, missing key (silent no-op), invalid key (controlled failure).
- [`env-vars-vercel-supabase.md`](docs/checklists/env-vars-vercel-supabase.md) — required/optional matrix per environment + Vercel & Supabase scopes.
- [`security-hardening.md`](docs/checklists/security-hardening.md) — secret scan, RLS coverage, admin password/secret strength, no static admin routes, no public PII, cookie flags, HTTPS, incident response.

Dependency risk for the current lockfile is tracked in
[`docs/security/npm-audit-triage.md`](docs/security/npm-audit-triage.md).
A local convenience wrapper for the CI quality gates (type-check +
build + `lint:strict`) lives at
[`scripts/preflight.ps1`](scripts/preflight.ps1) — run with
`pwsh aeris/scripts/preflight.ps1`.

---

## 🌍 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Import project at vercel.com
3. Add environment variables
4. Deploy

### Custom Domain
Configure `aeris.sa` in Vercel dashboard.

---

## 📞 Support

- **WhatsApp:** +966558048004
- **Email:** support@aeris.sa

---

## 📝 License

Proprietary — All rights reserved © 2026 Aeris
