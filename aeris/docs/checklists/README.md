# Aeris Production Checklists

Operational checklists for the founder + on-call to run before every
production deploy and on demand. Each checklist follows the same shape:
**Purpose → When to run → Steps → Pass criteria → If it fails.**

These lists are intentionally manual and text-only so they stay
accurate as the UI evolves. Automated equivalents (Vitest / Playwright
/ a `scripts/preflight.sh`) are deferred to a future hardening phase.

## Index

| File | Checks | When to run |
|---|---|---|
| [production-readiness.md](production-readiness.md) | Master pre-deploy gate. Aggregates the other six. | Before every production deploy. |
| [ci-pipeline.md](ci-pipeline.md) | GitHub Actions workflow shape (triggers, Node 20, `npm ci`, type-check, build, `lint:strict`), no-secrets discipline, branch protection wired in, current `main` is green. | Before every production deploy and after any change to `.github/workflows/ci.yml`, `package.json`, or `package-lock.json`. |
| [admin-inbox-smoke-test.md](admin-inbox-smoke-test.md) | `/admin/login` + `/admin/leads` end-to-end UI flow + cookie-tamper UI check + Phase 4 promote button. | Before every deploy that touches `lib/admin/*`, `lib/supabase/queries/leads.ts`, `app/(admin)/**`, or `components/admin/**`. Also weekly. |
| [operator-flow-smoke-test.md](operator-flow-smoke-test.md) | Phase 4 end-to-end: lead → promote → dispatch → operator submits → admin accepts, plus re-dispatch race guard, expired-offer guard, tampered-token guard. | Before every deploy that touches Phase 4 surfaces (admin/trips, operator offer page, the three RPCs). Also weekly once Phase 4 is live. |
| [pwa-audit.md](pwa-audit.md) | PWA installability audit: manifest validity + linkage, theme-color/apple-touch-icon in `<head>`, service worker registered + controlling start_url, `beforeinstallprompt` on Android Chrome, static-asset caching, offline behavior, admin/operator correctly excluded from SW. **No Lighthouse score required.** | Before every deploy that touches `app/manifest.ts`, `public/sw.js`, `app/offline/page.tsx`, `components/pwa/**`, `app/layout.tsx`, `public/icons/**`, or `scripts/generate-pwa-icons.mjs`. Quarterly otherwise. |
| [supabase-migration-verification.md](supabase-migration-verification.md) | Migrations applied cleanly: enums, columns, indexes, trigger, RLS on, no anon policies on `lead_inquiries`, anon REST probes denied. | After every migration run on staging or production. |
| [resend-email-test.md](resend-email-test.md) | Founder lead-notification email sends correctly with valid key, fails closed without breaking submissions when key is missing/invalid. | After any change to `lib/notifications/lead-email.ts`, the form Server Action, or Resend env vars. |
| [env-vars-vercel-supabase.md](env-vars-vercel-supabase.md) | Required vs optional env vars per environment. Server-only vs `NEXT_PUBLIC_`. Vercel + Supabase scopes. | Before every deploy and after any env rotation. |
| [security-hardening.md](security-hardening.md) | Secret-scan, RLS coverage, admin password/secret strength, no static admin routes, no public PII, cookie flags, honeypot, HTTPS, incident response. | Before every production deploy. Quarterly full review. |

## Conventions

- Every step uses real, copy-pasteable commands (curl, SQL, env
  inspection).
- All Arabic UI labels in steps match what the user actually sees in
  the app, e.g. `"تغيير الحالة"`, `"حفظ الملاحظة"`, `"تسجيل الخروج"`.
- A checklist is "passed" only when **every** item under *Pass
  criteria* is true. Partial passes are failures — fix the root cause
  before deploying.
- The DAY-1 setup checklist at [`docs/DAY-1-CHECKLIST.md`](../DAY-1-CHECKLIST.md)
  is **not** part of this folder. It's a one-time bootstrap list, not
  a recurring operational one.

## Owner

Founder runs these. Codex audits the lists themselves on schema/route
changes.
