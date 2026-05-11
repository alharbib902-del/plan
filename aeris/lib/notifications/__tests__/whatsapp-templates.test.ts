/**
 * Phase 8.1 — unit tests for whatsapp templates.
 *
 * Run via:  npm run test:notifications-whatsapp-templates
 *
 * Cases covered:
 *   1. Welcome body contains company name + magic link
 *   2. Welcome body has the link on its own line (WhatsApp
 *      auto-link detection requires a leading newline + URL +
 *      trailing newline / EOF)
 *   3. Welcome body Western-digit numerals in expiry (project
 *      convention — not Arabic-Indic)
 *   4. Reset body contains company name + reset URL
 *   5. Reset body URL on its own line
 *   6. Reset body has the "ignore if not requested" disclaimer
 *   7. Both bodies stay under the 1000-character WhatsApp soft
 *      limit even with longish company names
 *   8. Templates do not include HTML / markdown that WhatsApp
 *      would render literally
 */

import { strict as assert } from 'node:assert';

import {
  buildOperatorWelcomeWhatsAppBody,
  buildOperatorPasswordResetWhatsAppBody,
} from '@/lib/notifications/whatsapp-templates/operator-welcome-wa';
import { buildOperatorOtpWhatsAppBody } from '@/lib/notifications/whatsapp-templates/operator-otp-wa';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}`);
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    failed++;
  }
}

// 7 days from a fixed point so the tests stay deterministic
// across runs — Intl.DateTimeFormat uses the system locale data
// and the test asserts only on shape, not exact wording, but
// the date components are checked numerically.
const FIXED_EXPIRY = new Date('2026-05-18T09:30:00Z');

const SAMPLE_WELCOME = {
  company_name: 'Probe 14 Aviation Co',
  welcome_url: 'https://aeris.sa/operator/welcome/raw-token-here',
  expires_at: FIXED_EXPIRY,
};

const SAMPLE_RESET = {
  company_name: 'Probe 14 Aviation Co',
  reset_url: 'https://aeris.sa/operator/reset-password/raw-token-here',
  expires_at: FIXED_EXPIRY,
};

// ============================================================
// Welcome
// ============================================================

test('welcome: contains company name + magic link', () => {
  const body = buildOperatorWelcomeWhatsAppBody(SAMPLE_WELCOME);
  assert.match(body, /Probe 14 Aviation Co/);
  assert.match(body, /aeris\.sa\/operator\/welcome\/raw-token-here/);
});

test('welcome: link on its own line', () => {
  const body = buildOperatorWelcomeWhatsAppBody(SAMPLE_WELCOME);
  // The URL line is bracketed by blank lines so WhatsApp's
  // auto-link detector renders it as a tappable URL.
  assert.match(body, /\n\nhttps:\/\/aeris\.sa\/operator\/welcome\/raw-token-here\n\n/);
});

test('welcome: Western-digit numerals in expiry', () => {
  const body = buildOperatorWelcomeWhatsAppBody(SAMPLE_WELCOME);
  // Project convention: 1/2/3 not ١/٢/٣. Body must include
  // a Western digit and must NOT include any Arabic-Indic digits.
  assert.match(body, /[0-9]/);
  assert.equal(/[٠-٩]/.test(body), false);
});

test('welcome: under 1000 char WhatsApp soft limit', () => {
  const body = buildOperatorWelcomeWhatsAppBody({
    ...SAMPLE_WELCOME,
    company_name: 'A'.repeat(120), // longish company name
  });
  assert.ok(body.length < 1000, `body length ${body.length} exceeds 1000`);
});

test('welcome: no HTML / markdown rendered literally', () => {
  const body = buildOperatorWelcomeWhatsAppBody(SAMPLE_WELCOME);
  assert.equal(/<[a-z]+>/i.test(body), false);
  assert.equal(/\*\*[^*]+\*\*/.test(body), false);
});

// ============================================================
// Password reset
// ============================================================

test('reset: contains company name + reset URL', () => {
  const body = buildOperatorPasswordResetWhatsAppBody(SAMPLE_RESET);
  assert.match(body, /Probe 14 Aviation Co/);
  assert.match(body, /aeris\.sa\/operator\/reset-password\/raw-token-here/);
});

test('reset: URL on its own line', () => {
  const body = buildOperatorPasswordResetWhatsAppBody(SAMPLE_RESET);
  assert.match(
    body,
    /\n\nhttps:\/\/aeris\.sa\/operator\/reset-password\/raw-token-here\n\n/
  );
});

test('reset: includes "ignore if not requested" disclaimer', () => {
  const body = buildOperatorPasswordResetWhatsAppBody(SAMPLE_RESET);
  // Arabic copy: phishing / accidental-trigger guard.
  assert.match(body, /إن لم تطلبوا/);
});

test('reset: under 1000 char WhatsApp soft limit', () => {
  const body = buildOperatorPasswordResetWhatsAppBody({
    ...SAMPLE_RESET,
    company_name: 'A'.repeat(120),
  });
  assert.ok(body.length < 1000, `body length ${body.length} exceeds 1000`);
});

test('reset: no HTML / markdown rendered literally', () => {
  const body = buildOperatorPasswordResetWhatsAppBody(SAMPLE_RESET);
  assert.equal(/<[a-z]+>/i.test(body), false);
  assert.equal(/\*\*[^*]+\*\*/.test(body), false);
});

// ============================================================
// OTP (Codex round 1 PR #46 P1)
// ============================================================

const SAMPLE_OTP_LOGIN = {
  company_name: 'Probe 14 Aviation Co',
  code: '482196',
  purpose: 'login' as const,
  expires_in_minutes: 10,
};

const SAMPLE_OTP_RECOVERY = {
  company_name: 'Probe 14 Aviation Co',
  code: '004721',
  purpose: 'recovery' as const,
  expires_in_minutes: 10,
};

test('otp: contains company name + 6-digit code', () => {
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_LOGIN);
  assert.match(body, /Probe 14 Aviation Co/);
  assert.match(body, /482196/);
});

test('otp: code on its own line for one-tap copy', () => {
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_LOGIN);
  // Bracketed by blank lines so the code is the only token on
  // its line and WhatsApp Android/iOS long-press selects it
  // cleanly.
  assert.match(body, /\n\n482196\n\n/);
});

test('otp: leading-zero code preserved', () => {
  // The OTP generator pads to 6 digits; the template MUST not
  // strip a leading zero (e.g. '004721' becoming '4721' would
  // make verification fail).
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_RECOVERY);
  assert.match(body, /\n\n004721\n\n/);
});

test('otp: login purpose label is Arabic "تسجيل الدخول"', () => {
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_LOGIN);
  assert.match(body, /تسجيل الدخول/);
  assert.equal(/استرداد/.test(body), false);
});

test('otp: recovery purpose label is Arabic "استرداد الحساب"', () => {
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_RECOVERY);
  assert.match(body, /استرداد الحساب/);
  assert.equal(/تسجيل الدخول/.test(body), false);
});

test('otp: contains anti-phishing notice', () => {
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_LOGIN);
  // "Do not share this code" + "Aeris staff will not ask you
  // for it" — the standard 2FA-template guard.
  assert.match(body, /لا تشاركوا هذا الرمز/);
  assert.match(body, /لن يطلبوه/);
});

test('otp: states expiry in minutes (Western digit)', () => {
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_LOGIN);
  assert.match(body, /10 دقائق/);
  // Project convention: no Arabic-Indic digits anywhere in body.
  assert.equal(/[٠-٩]/.test(body), false);
});

test('otp: under 1000 char WhatsApp soft limit', () => {
  const body = buildOperatorOtpWhatsAppBody({
    ...SAMPLE_OTP_LOGIN,
    company_name: 'A'.repeat(120),
  });
  assert.ok(body.length < 1000, `body length ${body.length} exceeds 1000`);
});

test('otp: no HTML / markdown rendered literally', () => {
  const body = buildOperatorOtpWhatsAppBody(SAMPLE_OTP_LOGIN);
  assert.equal(/<[a-z]+>/i.test(body), false);
  assert.equal(/\*\*[^*]+\*\*/.test(body), false);
});

// ============================================================
// Summary
// ============================================================

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
