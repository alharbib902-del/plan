# Partner Demo Runbook — Aeris

A repeatable script for walking partners (operators / investors) through Aeris **on a staging environment** — without touching production or opening risk. Demo-readiness today: **GO (~78/100)**.

> Golden rules: **(1) demo on STAGING, never prod** (prod has Cargo/MedEvac live + real leads). **(2)** leave Resend/WhatsApp creds **blank** so no real messages fire. **(3)** keep `ENABLE_PAYMENTS=false` and `ENABLE_TRIP_AUTO_DISTRIBUTION=false`. **(4)** pre-flight every screen the night before — a missing flag renders a blank/404 surface (fail-closed).

---

## 1. Environment (T‑1 day)

Stand up a **separate** Supabase project + a Vercel Preview; apply migrations `000001 … 000010` to the staging DB (via the `migration-runner`, session pooler — see `CLAUDE.md`). Then set this **demo flag set** (these are NOT all in `.env.example` — add by hand):

```
# Portals & surfaces
ENABLE_CLIENT_PORTAL=true
ENABLE_OPERATOR_PORTAL=true                 # MUST be literal "true" (Server Actions are fail-closed)
ENABLE_OPERATOR_PORTAL_ADMIN=true
ENABLE_OPERATOR_LEGACY_TOKEN=true           # keeps the no-login /operator/offer/[token] link working
ENABLE_CLIENT_EMPTY_LEGS_PORTAL=true
ENABLE_EMPTY_LEGS_ADMIN_UI=true
ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE=true
NEXT_PUBLIC_ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE=true   # twin — drives the public nav link
ENABLE_CARGO=true
ENABLE_MEDEVAC=true
ENABLE_PRIVILEGE=true
PHASE5_ADMIN_UI=true                        # multi-operator dispatch panel (nicer to show)

# Keep OFF for the demo
ENABLE_PAYMENTS=false
ENABLE_TRIP_AUTO_DISTRIBUTION=false
```

Plus the **secrets** each surface needs (fail-closed if missing): `ADMIN_AUTH_SECRET`, `ADMIN_AUDIT_FINGERPRINT_SECRET`, `ADMIN_FOUNDER_EMAIL`, `ADMIN_INBOX_PASSWORD`, `CUSTOMER_CHECKOUT_SECRET`, `CRON_SECRET`, `OPERATOR_TOKEN_SECRET`, `OPERATOR_WELCOME_TOKEN_SECRET`, `OPERATOR_PASSWORD_RESET_TOKEN_SECRET`, `OPERATOR_OTP_SECRET`, `OPERATOR_SESSION_SECRET`, `CLIENT_PASSWORD_RESET_TOKEN_SECRET`, plus `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SITE_URL`. **Leave `RESEND_*` and the wasender keys blank** (sends become no-ops).

---

## 2. Seed data (T‑1 day, ~30–45 min — no seed script exists yet)

1. **Admin:** visit `/admin/login`, sign in with `ADMIN_FOUNDER_EMAIL` + `ADMIN_INBOX_PASSWORD` → founder row auto-seeds (only when `admin_users` is empty) → set a new password.
2. **Approved operator:** create one (operator self-signup at `/operator/signup`, or an admin stub) → in `/admin/operators` open it and **approve**. The approve action **returns a `/operator/welcome/{token}` link** (email/WhatsApp are no-ops without creds) — copy it from the action result / server log, open it, set a password. Add **1 aircraft + 1 crew** so those screens aren't empty.
3. **A trip with an offer ready to accept:** submit a request at `/request` (or a client charter) → `/admin/trips` open it → **dispatch (DispatchPanelV2)** to the operator's phone → copy the operator offer link → submit a priced offer as the operator. (Leave it submitted; you'll accept it live.)
4. **Breadth data so no screen is empty:** publish 1 empty leg, create 1 cargo request (+ offer), 1 medevac request, and grant a client a Privilege tier.
5. **Pre-flight:** click **every** screen in the path below; a blank surface = a missing flag.

---

## 3. Payments in the demo

`ENABLE_PAYMENTS=false` + no live HyperPay creds. **Recommended demo-safe story = the offline checkout link** (matches where the business actually is):

- From the admin booking/add-ons screen, use **"إصدار رابط دفع العميل"** → opens `/booking/{token}/checkout-prep` → client reviews add-ons → confirms → handed to WhatsApp to finalize. Nothing can break live.
- Narrate cards as: *"card rails (HyperPay) are integrated and in final certification; today settlement completes over our operated WhatsApp channel."*
- Only if you want to *show* the card widget: set `ENABLE_PAYMENTS=true` + `HYPERPAY_MODE=test` + **test** entity/access-token, pay a `pending_offline` booking with a HyperPay **test card** — **but rehearse it green first** (the widget has not been live-tested; the webhook verifier is a deliberate stub). Never call the webhook.

---

## 4. The live walk (~20–25 min)

1. **Public site** `/` — Hero → 5 services → Why-Aeris (the brand).
2. **Client request** `/request` — fill a quick charter request; show the WhatsApp handoff (our real intake today).
3. **Admin → Trips** — open the request, **dispatch via DispatchPanelV2** to the operator (show the fan-out).
4. **Operator offer** — open the signed link `/operator/offer/[token]`, show trip + add-ons, **submit a priced offer**.
5. **Client accepts** — `/me/requests/[id]` shows **all offers automatically** (comparison view) → accept → a **booking** is created (number, route, operator, total). *(Note: offers reach the client directly — there is no admin "forward the best" step.)*
6. **Payment (offline-safe)** — admin issues the checkout link → `/booking/[token]/checkout-prep` → confirm → WhatsApp finalize.
7. **Operator portal** `/operator/dashboard` → legs, **fleet, crew**, bookings. **(Skip Earnings.)**
8. **Breadth** — Admin **Analytics** → Empty Legs (outreach queue) → Cargo queue → MedEvac queue + cert matrix → a client's Privilege tier → Referrals. **Close on security** (MFA, audit log, rate-limiting) for due-diligence.

---

## 5. Do NOT show (or pre-empt)

- **Operator "الأرباح / Earnings"** — placeholder ("قريباً"); don't click it. ("Payouts dashboard is the next operator release.")
- **Booking cancellation** — not built (only trip-request cancellation exists). Don't promise self-service cancel.
- **Reviews as operator reputation** — reviews are collected but **never displayed** to operators/public today; pitch as "collection live, public ratings next."
- **The repo / `CLAUDE.md` history** — fine now (refreshed), but don't screen-share old branches.
- **Live HyperPay widget** unless rehearsed green; **auto-distribution** (keep off); any empty Cargo/MedEvac/Privilege screen (seed them first).
- **Arabic-only UI** — line up a translator/narration for non-Arabic partners (no English locale yet).

---

## Decisions still open
- **Demo payment mode:** offline link (recommended) vs HyperPay test widget (needs rehearsal).
- A **seed script** can replace step 2's manual setup once the staging environment is fixed — ask Claude to build it then.
