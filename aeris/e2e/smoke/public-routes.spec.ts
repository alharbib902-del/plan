import { expect, test } from '@playwright/test';

/**
 * Public-route smoke tests.
 *
 * These pages do not require auth + do not touch cookies/headers
 * server-side beyond what Next.js itself does, so they should
 * render for an anonymous visitor in any environment (dev,
 * preview, production).
 *
 * Why they matter for the Next 14 → 16 migration: even a
 * non-auth page is rendered by a server component that uses
 * the App Router runtime. If the dep upgrade breaks
 * `next.config.js` parsing, the build manifest, or the
 * Next/React peer compatibility, EVERY page returns a 500.
 * The cheapest regression net is "does the homepage HTML even
 * arrive 200 OK".
 */

test('homepage renders 200 + Arabic title', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  // The hero copy contains the Arabic brand mark; if Next
  // failed to render the server component, we'd see Next's
  // generic 500 page instead.
  await expect(page).toHaveTitle(/Aeris|أيريس|طيران/i);
});

test('public /privilege marketing page renders', async ({ page }) => {
  const response = await page.goto('/privilege');
  expect(response?.status()).toBe(200);
  // The 4 tier names (silver / gold / platinum / diamond) are
  // rendered server-side via lib/privilege/client-pii.ts
  // → readPublicTierThresholds(). If service-role + cookies
  // wiring breaks, this page is the canary.
  const body = await page.locator('body').textContent();
  expect(body).toBeTruthy();
  // At least one tier name in the rendered Arabic copy
  // (silver/gold/platinum/diamond translate to
  // فضي/ذهبي/بلاتيني/ماسي via lib/i18n/privilege-ar.ts).
  expect(body).toMatch(/فضي|ذهبي|بلاتيني|ماسي/);
});

test('public /empty-legs list page renders 200', async ({ page }) => {
  // Empty Legs list is a heavily server-rendered page that
  // reads from `empty_legs` via service-role. A successful 200
  // means the loose-cast Supabase chain still types correctly
  // under whatever React + Next version is installed.
  const response = await page.goto('/empty-legs');
  expect(response?.status()).toBe(200);
});
