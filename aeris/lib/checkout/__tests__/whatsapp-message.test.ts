/**
 * Phase 6.2 PR 2c — unit tests for buildWhatsappConfirmMessage.
 *
 * Mirrors the lib/addons/__tests__/catalog-vs-seed.test.ts
 * pattern: zero deps beyond Node's built-in assert + the SUT.
 * Run via:  npm run test:checkout-whatsapp
 *
 * Cases covered:
 *   1. Full case   — name + addons + return leg + passengers.
 *   2. Minimal     — guest mode, no addons, no return.
 *   3. Mixed       — name present, but customer removed all
 *                    addons (compact totals path).
 *   4. Trim        — leading/trailing whitespace on the name.
 *   5. WS-only     — whitespace-only name → guest mode.
 *   6. Multi-addon — three addons, ordering preserved.
 *   7. NULL pax    — passengers_count_snapshot omitted.
 */

import { strict as assert } from 'node:assert';

import { buildWhatsappConfirmMessage } from '@/lib/checkout/whatsapp-message';

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

// eslint-disable-next-line no-console
console.log('[whatsapp-message] running tests...');

// ────────────────────────────────────────────────────────────
// Case 1: Full case — name + addons + return.
// ────────────────────────────────────────────────────────────

test('Case 1: full case (name + addons + return + passengers)', () => {
  const result = buildWhatsappConfirmMessage({
    customerName: 'أحمد العتيبي',
    bookingNumber: 'AER-B-260507277A',
    routeFormatted: 'جدة ← الرياض',
    // The (بتوقيت الرياض) suffix is part of the caller's
    // formatted string (post-PR 2c hotfix). The builder no
    // longer appends it.
    departureFormatted: '10 مايو 2026، 03:00 (بتوقيت الرياض)',
    returnFormatted: '12 مايو 2026، 18:00 (بتوقيت الرياض)',
    passengersCount: 2,
    baseAmount: 45000,
    addonsAmount: 1100,
    totalAmount: 46100,
    activeAddons: [
      { labelAr: 'وجبات Arabic Premium', quantity: 2, totalPrice: 1100 },
    ],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/abc/checkout-prep',
  });

  assert.match(result, /^السلام عليكم ورحمة الله،/, 'starts with greeting');
  assert.match(
    result,
    /أنا أحمد العتيبي، أؤكّد حجزي مع Aeris\./,
    'name clause present'
  );
  assert.match(result, /رقم الحجز: AER-B-260507277A/, 'booking number');
  assert.match(result, /المسار: جدة ← الرياض/, 'route');
  assert.match(
    result,
    /المغادرة: 10 مايو 2026، 03:00 \(بتوقيت الرياض\)/,
    'departure with Riyadh suffix'
  );
  assert.match(
    result,
    /العودة: 12 مايو 2026، 18:00 \(بتوقيت الرياض\)/,
    'return with Riyadh suffix'
  );
  assert.match(result, /عدد الركاب: 2/, 'passengers count');
  assert.match(
    result,
    /الخدمات الإضافية:\n• وجبات Arabic Premium \(×2\) — 1,100 ريال/,
    'addons section formatted'
  );
  assert.match(
    result,
    /الإجمالي:\n• أجرة الرحلة: 45,000 ريال\n• الخدمات الإضافية: 1,100 ريال\n• الإجمالي النهائي: 46,100 ريال/,
    'full breakdown when addons present'
  );
  assert.match(
    result,
    /رابط مراجعة الحجز:\nhttps:\/\/aeris-flax\.vercel\.app\/booking\/abc\/checkout-prep/,
    'review URL block'
  );
  assert.match(result, /أرجو إفادتي بخطوات إكمال الدفع\./, 'closing line 1');
  assert.match(result, /وشكراً لكم\.$/, 'ends with thanks');
});

// ────────────────────────────────────────────────────────────
// Case 2: Minimal — guest mode, no addons, no return.
// ────────────────────────────────────────────────────────────

test('Case 2: minimal (guest mode, no addons, no return)', () => {
  const result = buildWhatsappConfirmMessage({
    customerName: null,
    bookingNumber: 'AER-B-DEADBEEF',
    routeFormatted: 'الرياض ← دبي',
    departureFormatted: '20 يونيو 2026، 14:00 (بتوقيت الرياض)',
    returnFormatted: null,
    passengersCount: 4,
    baseAmount: 80000,
    addonsAmount: 0,
    totalAmount: 80000,
    activeAddons: [],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/xyz/checkout-prep',
  });

  // Name clause omitted, simple intro takes over.
  assert.match(
    result,
    /^السلام عليكم ورحمة الله،\n\nأؤكّد حجزي مع Aeris\.\n/,
    'guest-mode intro (no name clause)'
  );
  assert.doesNotMatch(result, /أنا /, 'no "أنا [name]" clause');

  // Return + addons section absent.
  assert.doesNotMatch(result, /العودة:/, 'no return line');
  assert.doesNotMatch(
    result,
    /^الخدمات الإضافية:$/m,
    'no addons section heading'
  );

  // Compact totals — single line, no breakdown.
  assert.match(result, /\nالإجمالي: 80,000 ريال\n/, 'compact totals line');
  assert.doesNotMatch(result, /أجرة الرحلة:/, 'no breakdown');
  assert.doesNotMatch(result, /الإجمالي النهائي:/, 'no grand-total label');

  // Review URL still present.
  assert.match(
    result,
    /رابط مراجعة الحجز:\nhttps:\/\/aeris-flax\.vercel\.app\/booking\/xyz\/checkout-prep/,
    'review URL still rendered'
  );
});

// ────────────────────────────────────────────────────────────
// Case 3: Name present, no active addons (post-customer-remove).
// ────────────────────────────────────────────────────────────

test('Case 3: name + no active addons (post customer-remove)', () => {
  const result = buildWhatsappConfirmMessage({
    customerName: 'فاطمة الزهراني',
    bookingNumber: 'AER-B-CAFEFADE',
    routeFormatted: 'جدة ← القاهرة',
    departureFormatted: '5 يوليو 2026، 09:30 (بتوقيت الرياض)',
    returnFormatted: null,
    passengersCount: 1,
    baseAmount: 60000,
    addonsAmount: 0,
    totalAmount: 60000,
    activeAddons: [],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/p/checkout-prep',
  });

  assert.match(
    result,
    /أنا فاطمة الزهراني، أؤكّد حجزي مع Aeris\./,
    'name clause kept'
  );
  assert.doesNotMatch(
    result,
    /^الخدمات الإضافية:$/m,
    'no addons section heading'
  );
  assert.match(result, /\nالإجمالي: 60,000 ريال\n/, 'compact totals');
});

// ────────────────────────────────────────────────────────────
// Case 4: Customer name with surrounding whitespace.
// ────────────────────────────────────────────────────────────

test('Case 4: customer name is trimmed', () => {
  const result = buildWhatsappConfirmMessage({
    customerName: '   محمد القحطاني   ',
    bookingNumber: 'AER-B-12345678',
    routeFormatted: 'الرياض ← جدة',
    departureFormatted: '1 أغسطس 2026، 10:00 (بتوقيت الرياض)',
    returnFormatted: null,
    passengersCount: 3,
    baseAmount: 50000,
    addonsAmount: 0,
    totalAmount: 50000,
    activeAddons: [],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/q/checkout-prep',
  });
  assert.match(
    result,
    /أنا محمد القحطاني، أؤكّد حجزي مع Aeris\./,
    'name trimmed to inner content'
  );
  assert.doesNotMatch(
    result,
    /\sمحمد القحطاني\s\sالقحطاني/,
    'no double-space artifacts'
  );
});

// ────────────────────────────────────────────────────────────
// Case 5: Whitespace-only name → guest mode.
// ────────────────────────────────────────────────────────────

test('Case 5: whitespace-only name → guest mode', () => {
  const result = buildWhatsappConfirmMessage({
    customerName: '   ',
    bookingNumber: 'AER-B-WS00000',
    routeFormatted: 'الرياض ← مسقط',
    departureFormatted: '15 سبتمبر 2026، 16:00 (بتوقيت الرياض)',
    returnFormatted: null,
    passengersCount: 2,
    baseAmount: 70000,
    addonsAmount: 0,
    totalAmount: 70000,
    activeAddons: [],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/r/checkout-prep',
  });
  assert.doesNotMatch(result, /أنا /, 'no name clause for whitespace-only');
  assert.match(
    result,
    /أؤكّد حجزي مع Aeris\./,
    'simple confirmation intro'
  );
});

// ────────────────────────────────────────────────────────────
// Case 6: Multiple addons preserve caller-supplied ordering.
// ────────────────────────────────────────────────────────────

test('Case 6: multiple addons render in caller-supplied order', () => {
  const result = buildWhatsappConfirmMessage({
    customerName: 'سارة',
    bookingNumber: 'AER-B-MULTI001',
    routeFormatted: 'جدة ← الرياض',
    departureFormatted: '10 أكتوبر 2026، 12:00 (بتوقيت الرياض)',
    returnFormatted: null,
    passengersCount: 4,
    baseAmount: 100000,
    addonsAmount: 8500,
    totalAmount: 108500,
    activeAddons: [
      { labelAr: 'ليموزين Executive', quantity: 1, totalPrice: 550 },
      { labelAr: 'وجبات Arabic Premium', quantity: 4, totalPrice: 2200 },
      { labelAr: 'تخصيص داخلي', quantity: 1, totalPrice: 5750 },
    ],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/s/checkout-prep',
  });

  // Grab the addons block (between heading and the blank line before totals).
  const blockMatch = result.match(
    /الخدمات الإضافية:\n((?:• .+\n)+)\nالإجمالي:/
  );
  assert.ok(blockMatch, 'addons block present');
  const addonLines = blockMatch[1].trim().split('\n');
  assert.equal(addonLines.length, 3, 'three addon rows');
  assert.match(addonLines[0]!, /ليموزين Executive \(×1\) — 550 ريال/);
  assert.match(addonLines[1]!, /وجبات Arabic Premium \(×4\) — 2,200 ريال/);
  assert.match(addonLines[2]!, /تخصيص داخلي \(×1\) — 5,750 ريال/);

  // Verify totals breakdown reflects the addons-present path.
  assert.match(
    result,
    /• أجرة الرحلة: 100,000 ريال/,
    'base amount in breakdown'
  );
  assert.match(
    result,
    /• الخدمات الإضافية: 8,500 ريال/,
    'addons subtotal'
  );
  assert.match(
    result,
    /• الإجمالي النهائي: 108,500 ريال/,
    'grand total'
  );
});

// ────────────────────────────────────────────────────────────
// Case 7: NULL passengers count → line omitted.
// ────────────────────────────────────────────────────────────

test('Case 7: NULL passengers count → omitted', () => {
  const result = buildWhatsappConfirmMessage({
    customerName: 'علي',
    bookingNumber: 'AER-B-NOPAX',
    routeFormatted: 'الدمام ← أبوظبي',
    departureFormatted: '20 نوفمبر 2026، 08:00 (بتوقيت الرياض)',
    returnFormatted: null,
    passengersCount: null,
    baseAmount: 40000,
    addonsAmount: 0,
    totalAmount: 40000,
    activeAddons: [],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/t/checkout-prep',
  });
  assert.doesNotMatch(result, /عدد الركاب:/, 'no passengers line');
  // Other trip-details lines still rendered.
  assert.match(result, /رقم الحجز: AER-B-NOPAX/);
  assert.match(result, /المسار: الدمام ← أبوظبي/);
});

// ────────────────────────────────────────────────────────────
// Case 8: regression guard for the PR 2c hotfix.
// ────────────────────────────────────────────────────────────

test('Case 8 (regression): (بتوقيت الرياض) suffix is NOT duplicated', () => {
  // PR 2c shipped with the builder appending the
  // `(بتوقيت الرياض)` suffix to the departure / return lines,
  // but the caller (`formatRiyadhDateTime`) already includes
  // it. Production smoke caught the resulting double-suffix
  // ("(بتوقيت الرياض) (بتوقيت الرياض)") on the WhatsApp
  // message. This test guards against the regression: verify
  // the suffix appears EXACTLY ONCE per line, even when the
  // caller passes in a value that already contains the
  // suffix.
  const result = buildWhatsappConfirmMessage({
    customerName: 'باسم الحجري',
    bookingNumber: 'AER-B-DUPSUFFIX',
    routeFormatted: 'جدة ← الرياض',
    departureFormatted: '10 مايو 2026، 03:00 (بتوقيت الرياض)',
    returnFormatted: '12 مايو 2026، 18:00 (بتوقيت الرياض)',
    passengersCount: 2,
    baseAmount: 45000,
    addonsAmount: 0,
    totalAmount: 45000,
    activeAddons: [],
    reviewUrl: 'https://aeris-flax.vercel.app/booking/dup/checkout-prep',
  });

  const departureLineMatch = result.match(/^• المغادرة: .+$/m);
  assert.ok(departureLineMatch, 'departure line found');
  const departureSuffixCount = (
    departureLineMatch[0].match(/\(بتوقيت الرياض\)/g) ?? []
  ).length;
  assert.equal(
    departureSuffixCount,
    1,
    `expected exactly 1 (بتوقيت الرياض) on departure line, got ${departureSuffixCount}`
  );

  const returnLineMatch = result.match(/^• العودة: .+$/m);
  assert.ok(returnLineMatch, 'return line found');
  const returnSuffixCount = (
    returnLineMatch[0].match(/\(بتوقيت الرياض\)/g) ?? []
  ).length;
  assert.equal(
    returnSuffixCount,
    1,
    `expected exactly 1 (بتوقيت الرياض) on return line, got ${returnSuffixCount}`
  );

  // Sanity: no occurrence of the literal duplicated form
  // anywhere in the message.
  assert.doesNotMatch(
    result,
    /\(بتوقيت الرياض\)\s*\(بتوقيت الرياض\)/,
    'no double-suffix anywhere in the message'
  );
});

// ────────────────────────────────────────────────────────────
// Final summary + exit code.
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`[whatsapp-message] ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
