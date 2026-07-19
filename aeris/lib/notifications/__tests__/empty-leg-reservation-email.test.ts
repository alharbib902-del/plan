/**
 * P0 (2026-07) — unit tests for the empty-leg reservation
 * founder-alert email template.
 *
 * Run via:  npm run test:notifications-empty-leg-reservation-email
 *
 * Cases covered:
 *   1. Subject + body carry the leg number and reserver name
 *   2. Body carries route + departure window + hold expiry
 *   3. wa.me reply link points at the reserver's normalised
 *      phone (Saudi local 05… → 966…)
 *   4. Admin detail URL is /admin/empty-legs/<leg_id> on the
 *      site base URL
 *   5. RTL Arabic shell (lang="ar" dir="rtl")
 *   6. NO price leakage (request-to-book discipline — no
 *      'ريال' / SAR amounts anywhere)
 *   7. HTML escaping — a <script> payload in the reserver
 *      name is neutralised
 *   8. guest vs client kind label differs
 *   9. Western-digit convention (no Arabic-Indic digits)
 */

import { strict as assert } from 'node:assert';

import { buildEmptyLegReservationFounderEmail } from '@/lib/notifications/empty-leg-reservation-email';

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

const SAMPLE = {
  leg_id: '00000000-0000-0000-0000-00000000abcd',
  leg_number: 'EL-1042',
  route_from: 'RUH',
  route_to: 'JED',
  departure_window_start: '2026-07-20T09:00:00Z',
  departure_window_end: '2026-07-20T13:00:00Z',
  reserver_name: 'سارة العتيبي',
  reserver_phone: '0501234567',
  reserver_kind: 'guest' as const,
  reservation_expires_at: '2026-07-19T12:00:00Z',
};

// ============================================================
// Content
// ============================================================

test('subject carries leg number + reserver name', () => {
  const { subject } = buildEmptyLegReservationFounderEmail(SAMPLE);
  assert.match(subject, /EL-1042/);
  assert.match(subject, /سارة العتيبي/);
});

test('body carries leg number + route', () => {
  const { html } = buildEmptyLegReservationFounderEmail(SAMPLE);
  assert.match(html, /EL-1042/);
  assert.match(html, /RUH/);
  assert.match(html, /JED/);
});

test('body carries hold-expiry label (Riyadh note)', () => {
  const { html } = buildEmptyLegReservationFounderEmail(SAMPLE);
  assert.match(html, /ينتهي التحفّظ في/);
  assert.match(html, /توقيت الرياض/);
});

test('wa.me reply link targets the normalised reserver phone', () => {
  const { html } = buildEmptyLegReservationFounderEmail(SAMPLE);
  // 0501234567 (Saudi local) → wa.me/966501234567
  assert.match(html, /https:\/\/wa\.me\/966501234567\?text=/);
});

test('admin detail URL is /admin/empty-legs/<leg_id>', () => {
  const { html } = buildEmptyLegReservationFounderEmail(SAMPLE);
  assert.match(
    html,
    /https:\/\/aeris\.sa\/admin\/empty-legs\/00000000-0000-0000-0000-00000000abcd/
  );
});

// ============================================================
// Discipline
// ============================================================

test('RTL Arabic shell', () => {
  const { html } = buildEmptyLegReservationFounderEmail(SAMPLE);
  assert.match(html, /<html lang="ar" dir="rtl">/);
});

test('NO price leakage (request-to-book discipline)', () => {
  const { subject, html } = buildEmptyLegReservationFounderEmail(SAMPLE);
  assert.equal(html.includes('ريال'), false);
  assert.equal(subject.includes('ريال'), false);
  assert.equal(/SAR|سعر|السعر/.test(html), false);
});

test('HTML escaping neutralises a <script> payload in the name', () => {
  const { html } = buildEmptyLegReservationFounderEmail({
    ...SAMPLE,
    reserver_name: '<script>alert(1)</script>',
  });
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('guest vs client kind label differs', () => {
  const guest = buildEmptyLegReservationFounderEmail(SAMPLE);
  const client = buildEmptyLegReservationFounderEmail({
    ...SAMPLE,
    reserver_kind: 'client',
  });
  assert.match(guest.html, /زائر/);
  assert.match(client.html, /عميل مسجّل/);
});

test('Western-digit convention (no Arabic-Indic digits)', () => {
  const { html } = buildEmptyLegReservationFounderEmail(SAMPLE);
  assert.equal(/[٠-٩]/.test(html), false);
});

// ============================================================
// Summary
// ============================================================

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
