import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Aeris E2E foundation.
 *
 * Scope (this PR): smoke tests that verify pages render + the
 * Next.js App Router boots cleanly. Designed to be the
 * regression safety net for the upcoming Next 14 → 16
 * migration — that upgrade flips `cookies()` / `headers()` /
 * `params` to async APIs, and a missed `await` makes the
 * affected route render a 500 / blank page. These smoke tests
 * catch that class of breakage at the HTTP boundary without
 * needing seeded DB state.
 *
 * Deliberately OUT of scope:
 *   - Auth-required flows (login → MFA → dashboard)
 *   - DB seeding / Supabase fixtures
 *   - CI integration (GitHub Actions runs to follow)
 *   - Cross-browser (chromium only for now — Vercel + Cloudflare
 *     funnel real users into Chromium-based runtimes
 *     overwhelmingly; firefox/webkit add binary bloat without
 *     proportional bug-catching at this stage)
 *
 * Local usage:
 *   npm run test:e2e         → headless run, html reporter
 *   npm run test:e2e:ui      → interactive Playwright UI
 *
 * First-time setup (one-shot per workstation):
 *   npx playwright install chromium
 */

const PORT = Number.parseInt(process.env.E2E_PORT ?? '3000', 10);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',

  // Dev-server first-paint can take 5-15s in App Router. Tests
  // tolerate this without making the suite feel sluggish on
  // pages that ARE already compiled.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Parallel by default; one worker locally if CI=true so the
  // dev server doesn't get hammered.
  fullyParallel: !process.env.CI,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : 'html',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Arabic locale + RTL — matches the production app.
    locale: 'ar-SA',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Pipe dev-server stdout/stderr to Playwright stdio so a
    // 500 with a compile error surfaces in the test output
    // instead of buried in the dev console.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
