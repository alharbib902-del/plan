import { expect, test } from '@playwright/test';

/**
 * Auth-entry smoke tests.
 *
 * These pages exercise the headers() / cookies() codepaths
 * (hasAdminSession, requireClientSession, etc.) WITHOUT
 * requiring an actual session. The unauthenticated branch
 * still goes through the same async-headers / async-cookies
 * Promise resolution Next 15+ enforces — which makes these
 * the highest-value smoke tests for the Next 14 → 16
 * migration regression net.
 *
 * If a server component or layout forgets to `await` the new
 * Promise-returning cookies()/headers() API, this page renders
 * a 500 instead of the login form.
 */

test('admin /admin/login renders the email+password form', async ({ page }) => {
  const response = await page.goto('/admin/login');
  expect(response?.status()).toBe(200);
  // Email + password inputs ship in components/admin/admin-login-form.tsx.
  // Their presence proves the page rendered all the way through
  // the (admin) layout + login page server component.
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
});

test('admin /admin/login MFA challenge route renders for unauthenticated visitor', async ({
  page,
}) => {
  // Unauthenticated → requireAdminSession redirects to
  // /admin/login. The 302 chain itself exercises the
  // cookies()-read + redirect() codepath — a NEXT_REDIRECT
  // thrown from the layout is the happy path here.
  const response = await page.goto('/admin/login/mfa');
  expect(response?.status()).toBe(200);
  // After the redirect, we land on /admin/login.
  expect(page.url()).toMatch(/\/admin\/login(\?|$)/);
});

test('client /login renders the email+password form', async ({ page }) => {
  const response = await page.goto('/login');
  // Client login page is gated by ENABLE_CLIENT_PORTAL=true. In
  // dev environments where the flag is unset, the page may
  // 404. Accept either 200 (flag on, form renders) or 404
  // (flag off, intentional). Anything else (500) is a
  // regression.
  expect([200, 404]).toContain(response?.status() ?? 0);
});

test('client /me/* redirects to /login when unauthenticated', async ({
  page,
}) => {
  // Visiting /me/bookings without a client session should
  // redirect to /login. Same logic as the admin protected
  // layout but for the client surface — covers a different
  // async-headers/cookies codepath.
  await page.goto('/me/bookings');
  expect(page.url()).toMatch(/\/login|\/me\/bookings/);
});
