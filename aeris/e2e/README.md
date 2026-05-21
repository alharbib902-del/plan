# Aeris E2E foundation

Playwright-based end-to-end smoke tests. Designed as the
regression safety net for the upcoming Next 14 → 16 migration,
not as a comprehensive test suite.

## What's here

```
e2e/
├── smoke/
│   ├── public-routes.spec.ts    — anonymous pages render 200
│   └── auth-entry.spec.ts       — login pages render without DB state
└── README.md                    — this file
```

The smoke suite is intentionally **shallow + DB-free**. It
catches the class of regression that's most likely to hit a
framework upgrade: route components failing to render because
the runtime contract changed (e.g. `cookies()` becoming async
in Next 15). It does NOT catch business-logic regressions
inside the rendered page.

## One-time local setup

```bash
cd aeris
npx playwright install chromium
```

This downloads the Chromium binary into `~/Library/Caches/ms-playwright`
(macOS) / `%LOCALAPPDATA%\ms-playwright` (Windows). Re-runs are
idempotent.

## Running locally

```bash
npm run test:e2e          # headless, html report opens on failure
npm run test:e2e:ui       # interactive Playwright UI
```

Playwright auto-starts `npm run dev` and shuts it down when the
suite finishes (see `playwright.config.ts::webServer`). If you
already have `npm run dev` running, it'll reuse the existing
server.

Env overrides:
- `E2E_PORT` — port the dev server listens on (default 3000)
- `E2E_BASE_URL` — full base URL if not localhost

## Adding a new test

1. Create a new `.spec.ts` file under `e2e/smoke/` (or a new
   subdirectory for a richer category — `e2e/auth/`,
   `e2e/booking/`, etc.)
2. Import from `@playwright/test`:
   ```ts
   import { expect, test } from '@playwright/test';

   test('what it covers', async ({ page }) => {
     await page.goto('/some-route');
     // assertions
   });
   ```
3. Run `npm run test:e2e -- --headed` to watch it execute.

### Patterns the smoke suite follows

- **Assert HTTP status FIRST**, content second. A 500 with the
  right "title" still ships broken auth to users; a 200 with
  the wrong title is a copy fix.
- **Don't seed the DB**. The smoke suite must run on any deploy
  (preview, staging, production) without test fixtures. If you
  need DB state, that's a different test tier — propose a
  separate `e2e/integration/` directory + the Supabase seed
  strategy.
- **Don't test logged-in flows in this tier**. Real auth needs
  a seeded admin (with MFA) AND a seeded client. Stub-auth via
  cookie-injection is fragile. Wait for the proper integration
  tier (next PR after this foundation).

## Deliberately out of scope (this PR)

The following are real follow-up work, not blockers for the
foundation:

| Item | Why deferred |
|---|---|
| GitHub Actions CI workflow that runs Playwright on every PR | Each Playwright run downloads ~150MB of browser binaries. Wiring + caching the install in CI is its own PR. |
| Auth-required tests (admin login → MFA → dashboard, client accept-offer) | Need DB seeding strategy — see "Don't seed the DB" above. |
| Cross-browser (firefox / webkit) | Vercel + Cloudflare funnel almost all traffic into Chromium-based runtimes. Webkit-only bugs are rare for our stack and not worth the binary bloat at this stage. |
| Visual regression snapshots | High signal-to-noise ratio + flaky on font-loading races. Defer until a real diff need surfaces. |
| Accessibility audits (`@axe-core/playwright`) | Worthwhile but separate concern from "does the framework upgrade break the build". |

## When to use this suite

| Situation | Run E2E? |
|---|---|
| Bumping any dep that affects rendering (Next, React, Supabase, etc.) | **Yes** — full suite |
| Editing a server component | Maybe — only if you touch the auth boundary or a data-fetch helper |
| Editing a pure logic module (`lib/.../*-core.ts`) | No — Layer-1 tests cover this |
| Editing copy / Tailwind classes | No — visual regression isn't covered here |
| Pre-deploy of a security/auth change | **Yes** — even if Layer-1 + type-check passed, the smoke suite catches contract drift |
