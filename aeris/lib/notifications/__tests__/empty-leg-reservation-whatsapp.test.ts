/**
 * P0 (2026-07) — unit tests for the guest empty-leg
 * reservation WhatsApp confirmation template.
 *
 * Run via:  npm run test:notifications-empty-leg-reservation-whatsapp
 *
 * Cases covered:
 *   1. Body greets the guest + carries leg number and route
 *   2. Manage URL sits on its own line (WhatsApp auto-link
 *      detection requires a leading newline + URL + trailing
 *      newline / EOF)
 *   3. Hold window stated in minutes (60 دقيقة)
 *   4. NO price and NO marketing content (transactional
 *      discipline — keeps the sender number in good standing)
 *   5. Western-digit numerals (project convention — not
 *      Arabic-Indic)
 *   6. Under the 1000-character WhatsApp soft limit even with
 *      a long name + long URL
 *   7. No HTML / markdown that WhatsApp would render literally
 *   8. Phishing guard: the free-text guest name never carries a
 *      URL, domain, digit, newline or control char, is capped at
 *      40 chars, and falls back to a generic greeting
 */

import { strict as assert } from 'node:assert';

import {
  buildEmptyLegReservationWhatsAppBody,
  sanitiseGreetingName,
} from '@/lib/notifications/whatsapp-templates/empty-leg-reservation-wa';

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
  customer_name: 'سارة العتيبي',
  leg_number: 'EL-1042',
  route_from: 'RUH',
  route_to: 'JED',
  manage_url:
    'https://aeris.sa/empty-legs/EL-1042/reserved?token=raw-token-here',
  hold_minutes: 60,
};

test('greets the guest + carries leg number and route', () => {
  const body = buildEmptyLegReservationWhatsAppBody(SAMPLE);
  assert.match(body, /سارة العتيبي/);
  assert.match(body, /EL-1042/);
  assert.match(body, /RUH/);
  assert.match(body, /JED/);
});

test('manage URL on its own line', () => {
  const body = buildEmptyLegReservationWhatsAppBody(SAMPLE);
  assert.match(
    body,
    /\n\nhttps:\/\/aeris\.sa\/empty-legs\/EL-1042\/reserved\?token=raw-token-here\n\n/
  );
});

test('hold window stated in minutes', () => {
  const body = buildEmptyLegReservationWhatsAppBody(SAMPLE);
  assert.match(body, /60 دقيقة/);
});

test('NO price and NO marketing content', () => {
  const body = buildEmptyLegReservationWhatsAppBody(SAMPLE);
  assert.equal(body.includes('ريال'), false);
  assert.equal(/سعر|السعر/.test(body), false);
  // Marketing guardrails: no discount / offer / promo wording.
  assert.equal(/خصم|عرض|تخفيض/.test(body), false);
});

test('Western-digit numerals only', () => {
  const body = buildEmptyLegReservationWhatsAppBody(SAMPLE);
  assert.match(body, /[0-9]/);
  assert.equal(/[٠-٩]/.test(body), false);
});

test('under 1000 char WhatsApp soft limit', () => {
  const body = buildEmptyLegReservationWhatsAppBody({
    ...SAMPLE,
    customer_name: 'أ'.repeat(120),
    manage_url: `https://aeris.sa/empty-legs/EL-1042/reserved?token=${'t'.repeat(200)}`,
  });
  assert.ok(body.length < 1000, `body length ${body.length} exceeds 1000`);
});

test('no HTML / markdown rendered literally', () => {
  const body = buildEmptyLegReservationWhatsAppBody(SAMPLE);
  assert.equal(/<[a-z]+>/i.test(body), false);
  assert.equal(/\*\*[^*]+\*\*/.test(body), false);
});

// ============================================================
// Phishing guard — the guest name is attacker-controlled free
// text sent from Aeris's official number to a typed phone.
// ============================================================

function greetingLine(body: string): string {
  return body.split('\n')[0] ?? '';
}

test('name with a URL cannot carry a link into the message', () => {
  const body = buildEmptyLegReservationWhatsAppBody({
    ...SAMPLE,
    customer_name: 'حسابك موقوف ادخل https://evil.example/login فوراً',
  });
  const greeting = greetingLine(body);
  assert.equal(/https?|\/\/|\.|evil|example|login/.test(greeting), false, greeting);
  assert.equal(greeting, 'مرحباً حسابك موقوف ادخل فوراً،');
  // The only URL in the whole body is the real manage URL.
  assert.equal((body.match(/https?:\/\//g) ?? []).length, 1);
});

test('bare domains / emails are dropped whole', () => {
  assert.equal(sanitiseGreetingName('www.evil-aeris.com'), '');
  assert.equal(sanitiseGreetingName('سارة support@evil.co'), 'سارة');
});

test('name with phone numbers loses every digit (Western + Arabic-Indic)', () => {
  const name = sanitiseGreetingName('اتصل +966 50 123 4567 أو ٠٥٠١٢٣٤٥٦٧');
  assert.equal(/[0-9٠-٩۰-۹+]/.test(name), false, name);
});

test('newlines / control / bidi characters are stripped', () => {
  const body = buildEmptyLegReservationWhatsAppBody({
    ...SAMPLE,
    customer_name: 'سارة\n\nرسالة مزيفة\r\n‮abc​',
  });
  const greeting = greetingLine(body);
  assert.equal(/[\r‮​]/.test(body), false);
  assert.match(greeting, /^مرحباً سارة رسالة مزيفة abc،$/);
});

test('name is capped at 40 characters', () => {
  const name = sanitiseGreetingName('أ'.repeat(200));
  assert.equal(Array.from(name).length, 40);
});

test('name with nothing usable falls back to a generic greeting', () => {
  for (const raw of ['', '   ', '0501234567', 'https://x.y/z', '***']) {
    const body = buildEmptyLegReservationWhatsAppBody({
      ...SAMPLE,
      customer_name: raw,
    });
    assert.equal(greetingLine(body), 'مرحباً،', JSON.stringify(raw));
  }
});

test('ordinary Arabic / Latin names are kept (incl. diacritics, hyphen)', () => {
  assert.equal(sanitiseGreetingName('  مُحَمَّد   العتيبي '), 'مُحَمَّد العتيبي');
  assert.equal(sanitiseGreetingName("Anne-Marie O'Neil"), "Anne-Marie O'Neil");
});

// ============================================================
// Summary
// ============================================================

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
