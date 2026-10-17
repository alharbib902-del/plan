/**
 * Unit tests for the charter offer / new-request notification
 * builders (lib/notifications/charter-offer-templates.ts).
 *
 * Run via:  npm run test:notifications-charter-offer
 *
 * Cases covered:
 *   1. Client WhatsApp: greeting, request number, route, request URL
 *      on its own line; NO price and NO operator name
 *   2. Guest WhatsApp: "team will contact you", NO URL, NO price,
 *      NO operator name
 *   3. Client email: subject + CTA to /me/requests/<id>; NO price
 *   4. Founder offer email: operator, price, admin URL, wa.me link
 *      normalised to the customer's phone; guest vs client wording
 *   5. Founder new-request email: route, passengers, aircraft label,
 *      manual-dispatch hint when auto-distribution is off
 *   6. HTML escaping of user-controlled fields
 *   7. Western digits only + Gregorian Asia/Riyadh dates
 *   8. Route resolution: IATA → freeform → legacy leg text → —
 */

import { strict as assert } from 'node:assert';

import {
  buildClientOfferReceivedEmail,
  buildClientOfferReceivedWhatsAppBody,
  buildFounderNewClientRequestEmail,
  buildFounderOfferReceivedEmail,
  buildGuestOfferReceivedWhatsAppBody,
  formatRiyadhDateTime,
  resolveRouteEndpoints,
} from '@/lib/notifications/charter-offer-templates';

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

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
const ROUTE = { from: 'RUH', to: 'JED' };
const REQUEST_URL = 'https://aeris.sa/me/requests/11111111-2222-3333-4444-555555555555';

const CLIENT_INPUT = {
  full_name: 'سارة العتيبي',
  request_number: 'AER-2026-0042',
  route: ROUTE,
  request_url: REQUEST_URL,
};

test('client WhatsApp carries name, request number, route and URL line', () => {
  const body = buildClientOfferReceivedWhatsAppBody(CLIENT_INPUT);
  assert.match(body, /سارة العتيبي/);
  assert.match(body, /وصلك عرض جديد/);
  assert.match(body, /AER-2026-0042/);
  assert.match(body, /RUH ← JED/);
  assert.ok(body.split('\n').includes(REQUEST_URL), 'URL must sit on its own line');
});

test('client WhatsApp leaks no price / currency', () => {
  const body = buildClientOfferReceivedWhatsAppBody(CLIENT_INPUT);
  assert.doesNotMatch(body, /ريال|SAR|\d{1,3},\d{3}/);
});

test('client WhatsApp falls back to a generic greeting for a blank name', () => {
  const body = buildClientOfferReceivedWhatsAppBody({ ...CLIENT_INPUT, full_name: '  ' });
  assert.equal(body.split('\n')[0], 'مرحباً،');
});

test('guest WhatsApp promises team contact, no URL / price / operator', () => {
  const body = buildGuestOfferReceivedWhatsAppBody({
    customer_name: 'خالد',
    request_number: 'AER-2026-0043',
    route: ROUTE,
  });
  assert.match(body, /خالد/);
  assert.match(body, /AER-2026-0043/);
  assert.match(body, /سيتواصل معك فريق Aeris/);
  assert.doesNotMatch(body, /https?:\/\//);
  assert.doesNotMatch(body, /ريال|SAR/);
  assert.doesNotMatch(body, /Skybridge/);
});

test('guest WhatsApp handles a null name', () => {
  const body = buildGuestOfferReceivedWhatsAppBody({
    customer_name: null,
    request_number: 'AER-2026-0043',
    route: ROUTE,
  });
  assert.equal(body.split('\n')[0], 'مرحباً،');
});

test('client email: subject, CTA URL, RTL shell, no price', () => {
  const { subject, html } = buildClientOfferReceivedEmail(CLIENT_INPUT);
  assert.match(subject, /وصلك عرض جديد/);
  assert.match(subject, /AER-2026-0042/);
  assert.ok(html.includes(`href="${REQUEST_URL}"`));
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.doesNotMatch(html, /ريال/);
});

const FOUNDER_OFFER_INPUT = {
  request_number: 'AER-2026-0042',
  route: ROUTE,
  departure_date: '2026-11-01T09:30:00.000Z',
  operator_name: 'Skybridge Aviation',
  total_price_sar: 85000,
  aircraft: 'Citation XLS (HZ-ABC)',
  customer_kind: 'guest' as const,
  customer_name: 'خالد',
  customer_phone: '0501234567',
  admin_url: 'https://aeris.sa/admin/trips/abc',
};

test('founder offer email carries operator, price, admin URL', () => {
  const { subject, html } = buildFounderOfferReceivedEmail(FOUNDER_OFFER_INPUT);
  assert.match(subject, /AER-2026-0042/);
  assert.match(subject, /Skybridge Aviation/);
  assert.match(html, /85,000 ريال/);
  assert.match(html, /Citation XLS \(HZ-ABC\)/);
  assert.ok(html.includes('href="https://aeris.sa/admin/trips/abc"'));
});

test('founder offer email wa.me link uses the normalised customer phone', () => {
  const { html } = buildFounderOfferReceivedEmail(FOUNDER_OFFER_INPUT);
  assert.match(html, /https:\/\/wa\.me\/966501234567\?text=/);
});

test('founder offer email wording differs for guest vs client', () => {
  const guest = buildFounderOfferReceivedEmail(FOUNDER_OFFER_INPUT).html;
  const client = buildFounderOfferReceivedEmail({
    ...FOUNDER_OFFER_INPUT,
    customer_kind: 'client',
  }).html;
  assert.match(guest, /عميل زائر/);
  assert.match(client, /عميل مسجّل/);
  assert.notEqual(guest, client);
});

test('founder offer email escapes user-controlled fields', () => {
  const { html } = buildFounderOfferReceivedEmail({
    ...FOUNDER_OFFER_INPUT,
    operator_name: '<script>alert(1)</script>',
    customer_name: '"><img src=x>',
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.match(html, /&lt;script&gt;/);
});

test('founder offer email tolerates a missing phone', () => {
  const { html } = buildFounderOfferReceivedEmail({
    ...FOUNDER_OFFER_INPUT,
    customer_phone: null,
  });
  assert.doesNotMatch(html, /wa\.me/);
});

const NEW_REQUEST_INPUT = {
  request_number: 'AER-2026-0044',
  route: ROUTE,
  departure_date: '2026-11-01T09:30:00.000Z',
  return_date: null,
  passengers: 6,
  aircraft_pref_label: 'متوسطة',
  special_requests: 'طعام حلال <b>',
  client_name: 'سارة العتيبي',
  client_phone: '+966501234567',
  client_email: 'sara@example.com',
  auto_distribution: false,
  admin_url: 'https://aeris.sa/admin/trips/def',
};

test('founder new-request email: details + manual dispatch hint', () => {
  const { subject, html } = buildFounderNewClientRequestEmail(NEW_REQUEST_INPUT);
  assert.match(subject, /AER-2026-0044/);
  assert.match(subject, /سارة العتيبي/);
  assert.match(html, /RUH ← JED/);
  assert.match(html, />6</);
  assert.match(html, /متوسطة/);
  assert.match(html, /sara@example\.com/);
  assert.match(html, /وزّع الطلب على المشغّلين يدوياً/);
  assert.match(html, /طعام حلال &lt;b&gt;/);
  assert.ok(html.includes('href="https://aeris.sa/admin/trips/def"'));
});

test('founder new-request email: auto-distribution wording + no-preference label', () => {
  const { html } = buildFounderNewClientRequestEmail({
    ...NEW_REQUEST_INPUT,
    auto_distribution: true,
    aircraft_pref_label: null,
    special_requests: null,
  });
  assert.match(html, /وُزّع الطلب تلقائياً/);
  assert.match(html, /لا تفضيل/);
  assert.doesNotMatch(html, /طلبات خاصة/);
});

test('all builders use Western digits only', () => {
  const outputs = [
    buildClientOfferReceivedWhatsAppBody(CLIENT_INPUT),
    buildClientOfferReceivedEmail(CLIENT_INPUT).html,
    buildFounderOfferReceivedEmail(FOUNDER_OFFER_INPUT).html,
    buildFounderNewClientRequestEmail(NEW_REQUEST_INPUT).html,
  ];
  for (const out of outputs) {
    assert.doesNotMatch(out, ARABIC_INDIC_DIGITS);
  }
});

test('dates render Gregorian in Asia/Riyadh (09:30Z → 12:30)', () => {
  const label = formatRiyadhDateTime('2026-11-01T09:30:00.000Z');
  assert.match(label, /2026/);
  assert.match(label, /12:30/);
  assert.doesNotMatch(label, ARABIC_INDIC_DIGITS);
  assert.equal(formatRiyadhDateTime(null), '—');
  assert.equal(formatRiyadhDateTime('not-a-date'), 'not-a-date');
});

test('route resolution: IATA → freeform → legacy → dash', () => {
  assert.deepEqual(
    resolveRouteEndpoints({ departure_airport: 'RUH', arrival_airport: 'DXB', legs: [] }),
    { from: 'RUH', to: 'DXB' }
  );
  assert.deepEqual(
    resolveRouteEndpoints({
      departure_airport: null,
      arrival_airport: null,
      legs: [{ from: null, to: null, from_freeform: 'العُلا', to_freeform: 'نيوم' }],
    }),
    { from: 'العُلا', to: 'نيوم' }
  );
  assert.deepEqual(
    resolveRouteEndpoints({
      departure_airport: null,
      arrival_airport: null,
      legs: [{ from: 'الرياض', to: 'جدة' }],
    }),
    { from: 'الرياض', to: 'جدة' }
  );
  assert.deepEqual(
    resolveRouteEndpoints({ departure_airport: null, arrival_airport: null, legs: null }),
    { from: '—', to: '—' }
  );
});

// eslint-disable-next-line no-console
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
