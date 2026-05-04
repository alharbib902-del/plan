# CLAUDE.md — Aeris Project Context

> **This file is automatically loaded by Claude Code. It contains everything needed to work effectively on the Aeris project.**

---

## 🎯 Project Overview

**Aeris** is a smart integrated platform for private aviation services in Saudi Arabia and the GCC region. It's a **two-sided marketplace** connecting:
- **Clients** (private aviation customers)
- **Operators** (aircraft owners/charter companies)
- **Admin** (Aeris platform team)

### Core Products (5 Business Units)
1. **Aeris Charter** — Private flight booking with rich add-ons
2. **Aeris Empty Legs** — AI-matched empty return flights at discount
3. **Aeris Privilege** — 4-tier loyalty program (Silver/Gold/Platinum/Diamond)
4. **Aeris MedEvac** — Medical evacuation flights + Aeris Shield subscriptions
5. **Aeris Cargo** — Specialized cargo (horses, luxury cars, valuables)

### Scale Target
- **60-day MVP** with full automation
- **1,000+ customers** in first 6 months
- **54M SAR revenue** in year 1

---

## 🛠️ Tech Stack

### Core
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript (strict mode)
- **UI:** TailwindCSS + shadcn/ui + Radix UI
- **Animations:** Framer Motion
- **Forms:** React Hook Form + Zod validation
- **Data:** TanStack Query
- **Icons:** Lucide React

### Backend & Data
- **Database:** PostgreSQL (via Supabase)
- **Auth:** Supabase Auth (OTP + Email/Password)
- **Storage:** Supabase Storage
- **Realtime:** Supabase Realtime (for live updates)
- **API:** Next.js API Routes + Server Actions

### Automation Engines
- **Workflow Orchestration:** Inngest
- **Scheduled Jobs:** Vercel Cron + Supabase Edge Functions
- **AI:** Claude API (Anthropic) — for matching, pricing, content

### External Services
- **Payment:** HyperPay (primary), Moyasar (backup)
- **Email:** Resend
- **SMS:** Unifonic
- **WhatsApp:** wa.me links (NO API — human reply)
- **Compliance:** ZATCA E-Invoice API
- **Maps:** Mapbox GL JS
- **Flight Data:** Flightradar24 API
- **Weather:** AccuWeather API

### Infrastructure
- **Hosting:** Vercel (Next.js + Edge Functions)
- **Database:** Supabase Cloud
- **CDN:** Cloudflare
- **Monitoring:** Sentry (errors) + PostHog (analytics) + UptimeRobot (uptime)

---

## 🌐 Project Configuration

### Language & Locale
- **Primary:** Arabic (RTL) — `lang="ar" dir="rtl"`
- **Secondary:** English (LTR)
- **Currency:** SAR (Saudi Riyal) — displayed as "ريال"
- **Timezone:** Asia/Riyadh (UTC+3)
- **Number format:** Western digits (1, 2, 3) NOT Arabic-Indic

### Contact
- **Domain:** aeris.sa
- **WhatsApp:** +966558048004 (human-answered)
- **Support hours:** 24/7 (business hours for non-urgent)

### Brand Identity
- **Primary Color (Gold):** `#C9A961`
- **Primary Dark (Navy):** `#0A1628`
- **Secondary:** `#FAFAFA` (white), `#A8B2C1` (muted)
- **Gold variants:** `#E8D4A8` (light), `#8B7339` (dark)
- **Fonts:**
  - English: Playfair Display (headings) + Inter (body)
  - Arabic: IBM Plex Sans Arabic (all)

---

## 📁 Project Structure

```
aeris/
├── app/
│   ├── (auth)/              # Public auth routes
│   │   ├── login/
│   │   ├── signup/
│   │   └── verify-otp/
│   ├── (client)/            # Customer-facing routes
│   │   ├── page.tsx         # Home
│   │   ├── charter/
│   │   ├── trips/
│   │   ├── bookings/
│   │   ├── empty-legs/
│   │   ├── medevac/
│   │   ├── cargo/
│   │   ├── privilege/
│   │   └── me/
│   ├── operator/            # Operator portal
│   ├── admin/               # Admin panel
│   └── api/                 # API routes & webhooks
├── components/              # Reusable UI components
│   ├── ui/                  # shadcn/ui primitives
│   ├── booking/
│   ├── operator/
│   ├── admin/
│   └── shared/
├── lib/                     # Core libraries
│   ├── supabase/            # DB clients + queries
│   ├── hyperpay/            # Payment integration
│   ├── zatca/               # Invoice generation
│   ├── notifications/       # Email/SMS
│   ├── automation/          # Inngest workflows
│   ├── validators/          # Zod schemas
│   └── utils/               # Helpers
├── types/                   # TypeScript types
├── hooks/                   # React hooks
├── supabase/
│   └── migrations/          # DB migrations
└── public/                  # Static assets
```

---

## 🎨 Design System Rules

### Colors (TailwindCSS)
```typescript
// Defined in tailwind.config.ts
colors: {
  gold: {
    DEFAULT: '#C9A961',
    light: '#E8D4A8',
    dark: '#8B7339',
  },
  navy: {
    DEFAULT: '#0A1628',
    secondary: '#050B14',
    tertiary: '#0F1F35',
    card: '#0D1B30',
  },
  muted: '#6B7A8F',
  secondary: '#A8B2C1',
}
```

### Typography
- **Headlines (Arabic):** IBM Plex Sans Arabic, weight 500-700
- **Headlines (English):** Playfair Display, weight 400-600
- **Body (Arabic):** IBM Plex Sans Arabic, weight 400
- **Body (English):** Inter, weight 300-500

### Components Philosophy
- Always **RTL-first** for Arabic content
- Always **mobile-first** responsive
- Always use **shadcn/ui** components as base
- Always **accessible** (WCAG 2.1 AA)
- Always **animated** (subtle, luxurious — Framer Motion)

---

## 🗄️ Database Schema Overview

### Primary Tables (19 total)
1. **users** — All users (role: client/operator/admin/support)
2. **operators** — Operator companies
3. **aircraft** — Fleet
4. **crew_members** — Pilots & flight attendants
5. **airports** — IATA/ICAO reference data
6. **trip_requests** — Customer trip requests
7. **offers** — Operator offers to requests
8. **bookings** — Confirmed bookings
9. **booking_addons** — Selected add-ons per booking
10. **empty_legs** — Available empty return flights
11. **payments** — Payment transactions
12. **loyalty_transactions** — Points earned/redeemed
13. **reviews** — Post-flight ratings
14. **notifications** — Multi-channel notifications
15. **medevac_requests** — Medical evacuation requests
16. **medevac_subscriptions** — Aeris Shield subscriptions
17. **cargo_requests** — Specialized cargo requests
18. **support_tickets** — Customer support
19. **audit_logs** — Sensitive operations log

### Critical Fields
- All tables have: `id (UUID PK)`, `created_at`, `updated_at`
- All user-facing entities have: `status` enum
- All financial amounts: `DECIMAL(12,2)` for SAR
- All timestamps: `TIMESTAMPTZ`
- All text IDs follow pattern: `AER-XXXX` (bookings), `EL-XXXX` (empty legs), `MEV-XXXX` (medevac), `CGO-XXXX` (cargo)

### Row Level Security (RLS)
- Enabled on **every** table
- Users can only see their own data (based on `user_id`)
- Operators can only see their own fleet/bookings
- Admins see everything (but logged)

---

## 🤖 Automation Engines (Critical)

### 1. Trip Distribution Engine
**Trigger:** New trip_request created
**Location:** `lib/automation/trip-distribution.ts`
**Logic:**
```typescript
1. Query operators matching criteria (location, aircraft category, availability)
2. Score each operator (weighted: rating 40%, response time 30%, price 20%, location 10%)
3. Send to top 5 via Email + WhatsApp link
4. Set 2-hour response window
5. Escalate to admin if no responses
```

### 2. Empty Legs Matching Engine
**Trigger:** New empty_leg created OR price reduced
**Location:** `lib/automation/empty-legs-matching.ts`
**Logic:**
```typescript
1. Query eligible customers (location, history, preferences)
2. Calculate match_score for each (6 factors weighted)
3. Send top 50 matches via multi-channel
4. Track engagement (PostHog)
```

### 3. Dynamic Pricing Engine
**Trigger:** Pricing calculation requested (offers, empty legs)
**Location:** `lib/automation/pricing-engine.ts`
**Logic:**
```typescript
1. Base price from operator
2. Multipliers: demand, season, peak hours, route popularity
3. Discounts: Privilege tier, first-time user, referral
4. Time-based: Empty Legs Dutch auction (discount increases as departure nears)
```

### 4. Notification Pipeline
**Trigger:** Any system event requiring notification
**Location:** `lib/automation/notifications.ts`
**Channels:** Email (Resend), SMS (Unifonic), WhatsApp link (wa.me), In-app
**Templates:** Defined in `lib/notifications/templates/`

### 5. Automated Payouts
**Trigger:** Flight completed (+48 hours hold)
**Location:** `lib/automation/payouts.ts`
**Logic:** Calculate operator_payout = total - commission, transfer via bank API

### 6. Privilege Auto-Upgrade
**Trigger:** Booking payment confirmed
**Location:** `lib/automation/loyalty.ts`
**Logic:** Calculate annual spend, auto-upgrade tier if threshold reached

### 7. ZATCA Auto-Invoice
**Trigger:** Payment confirmed
**Location:** `lib/zatca/generator.ts`
**Output:** XML invoice + QR Code + PDF via Resend

---

## 🔐 Security Requirements

### Authentication
- JWT tokens with 1-hour expiry + refresh tokens
- OTP for phone verification
- 2FA **required** for admins and Platinum+ users
- Password: minimum 10 chars, must contain numbers + letters

### Authorization
- Row Level Security (RLS) on all tables
- API routes check user role before execution
- Admin actions are logged in `audit_logs`

### Data Protection
- Input validation: Zod on every API endpoint
- SQL injection: Use parameterized queries only (Supabase handles)
- XSS: React auto-escapes; sanitize any dangerouslySetInnerHTML
- CSRF: Use Next.js built-in protection
- Passport numbers: Encrypt at rest (AES-256)
- Payment details: Never store (use HyperPay tokenization)

### Compliance
- **ZATCA:** Phase 2 e-invoicing (all invoices)
- **PDPL:** Saudi data protection (consent, right to delete)
- **GDPR:** For EU customers (right to export)
- **PCI DSS:** No card storage (HyperPay compliant)

---

## 📝 Coding Conventions

### TypeScript
- **Strict mode** always on
- Define types in `types/` directory
- Prefer `interface` for object shapes, `type` for unions
- Never use `any` — use `unknown` if truly unknown

### Components
- Default export for page components
- Named exports for reusable components
- Co-locate component files: `Button.tsx`, `Button.test.tsx`, `Button.stories.tsx`
- Server components by default, mark client explicitly with `'use client'`

### API Routes
- Use Server Actions for mutations triggered from client
- Use API Routes for webhooks and external integrations
- Always validate input with Zod
- Always handle errors gracefully
- Return typed responses

### Naming
- **Files:** kebab-case (`trip-request-form.tsx`)
- **Components:** PascalCase (`TripRequestForm`)
- **Functions:** camelCase (`calculateMatchScore`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_PASSENGERS`)
- **Database tables:** snake_case (`trip_requests`)

### Comments
- **Default: NO comments.** Well-named code speaks for itself.
- Add comments ONLY for:
  - Non-obvious WHY (business logic, workarounds)
  - Complex algorithms
  - Security-sensitive code
- NEVER: describe WHAT the code does (that's visible)

---

## 🌍 RTL / Arabic Support

### HTML/CSS
- `<html lang="ar" dir="rtl">` by default
- Use `start`/`end` instead of `left`/`right` in Tailwind:
  - ❌ `ml-4` → ✅ `ms-4`
  - ❌ `pr-6` → ✅ `pe-6`
  - ❌ `text-left` → ✅ `text-start`

### Typography
- Arabic: IBM Plex Sans Arabic (imported from Google Fonts)
- Numbers: Always Western digits (1, 2, 3) for consistency
- Dates: Show both Gregorian + Hijri where appropriate

### Icons
- Directional icons (arrows) must flip in RTL
- Use `rtl:scale-x-[-1]` Tailwind utility

---

## 🚀 Development Workflow

### Daily Flow (14h/day — 60 days)
```
05:30-08:00  Deep Work 1 (2.5h) — Hardest tasks
08:00-08:30  Breakfast
08:30-12:30  Deep Work 2 (4h) — Main feature
12:30-13:30  Lunch + prayer
13:30-16:30  Deep Work 3 (3h) — Additional work
16:30-17:00  Break
17:00-20:00  Deep Work 4 (3h) — Testing + fixes
20:00-21:00  Dinner
21:00-23:00  Admin (1.5h) — Planning, BD, responses
```

### Git Workflow
- **main branch:** Production-ready only
- **dev branch:** Daily development
- **feature branches:** `feature/charter-booking`, `feature/empty-legs-matching`
- **Commit often:** At end of each feature
- **Commit message:** Clear, imperative (e.g., "Add Empty Legs Dutch auction cron")

### Claude Code Best Practices
1. **Use CLAUDE.md** (this file) — I'm always aware
2. **Plan mode** (ExitPlanMode) before complex features
3. **Subagents** for parallel tasks
4. **Security review** skill after each major feature
5. **Simplify** skill after finishing a feature
6. **Test iteratively** — don't wait until end

### Testing Strategy
- **Manual testing:** After each feature
- **E2E tests:** Playwright (Week 8)
- **Security scan:** Weekly (security-review skill)
- **Performance:** Lighthouse after each deployment

---

## 🎯 Current Sprint / Week

### Current Week: **Week 1 — Foundation**
### Today: **Day 1**
### Goals: Setup + Environment + Initial deployment

### Completed
- [ ] Accounts setup (Vercel, Supabase, Resend, etc.)
- [ ] Domain (aeris.sa)
- [ ] Next.js project initialized
- [ ] GitHub + Vercel connected

### In Progress
- [ ] CLAUDE.md (this file)

### Next
- [ ] Day 2: Design system + Tailwind config
- [ ] Day 3: Database schema creation
- [ ] Day 4: Auth system

---

## 📞 Key Contacts

| Role | Contact |
|------|---------|
| Founder | [Owner] |
| WhatsApp Support | +966558048004 |
| Technical Lead | Claude Code Opus 4.7 Max + Founder |
| Designer | TBD (Freelance, Week 1-3) |

---

## 📚 Reference Documents

Located in `D:/Plan/advisor-doc/`:
- `Aeris-Advisor-Study.docx` — Full business study
- `Aeris-Technical-Blueprint.docx` — Technical specification
- `Aeris-60-Days-Plan.docx` — Day-by-day development plan

Located in `D:/Plan/`:
- `index.html` — Investor pitch deck (Arabic)

---

## ⚠️ Important Notes for Claude Code

1. **NEVER** write code without RTL support
2. **NEVER** use LTR-specific Tailwind classes (use `start`/`end`)
3. **NEVER** store payment card details directly
4. **NEVER** hardcode Arabic strings — use i18n (later phase) or constants
5. **NEVER** skip input validation (Zod is your friend)
6. **ALWAYS** add audit logging to sensitive admin actions
7. **ALWAYS** test on mobile viewport (iPhone SE minimum)
8. **ALWAYS** ensure ZATCA compliance for invoices
9. **ALWAYS** respect user privacy (PDPL)
10. **ALWAYS** prefer Server Components unless interactivity needed

---

## 🎨 UI/UX Principles

### Luxury Feel
- Generous whitespace
- Subtle gold accents (not overwhelming)
- Smooth animations (300-500ms, ease-out)
- Serif fonts for display
- Large, readable Arabic

### Mobile First
- Test on iPhone SE (375px) minimum
- Touch targets minimum 44×44px
- Thumb-friendly navigation (bottom nav for mobile)

### Performance
- Image optimization (next/image + Supabase transformations)
- Code splitting per route
- Lazy loading below the fold
- Target: Lighthouse score > 90

---

**Last updated:** Day 1 — Project kickoff
**Updated by:** Founder + Claude Code Opus 4.7 Max
