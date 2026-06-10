/**
 * Payments PR1 — unit tests for the payment-core PURE logic.
 *
 * Runs as: npm run test:payments-core
 *
 * The payment-core modules (`app/actions/payments.ts`,
 * `lib/payments/{provider,hyperpay,payments}.ts`) are either `'use server'`
 * or guarded with `import 'server-only'`, so — exactly like the sibling
 * `app/actions/__tests__/privilege-admin-validators.test.ts`, which re-derives
 * its Zod schema rather than importing the `'use server'` action — these tests
 * RE-DERIVE the pure, network-free units inline (mirroring the source verbatim)
 * and assert against them. Nothing here touches a live DB or the gateway.
 *
 * Coverage (the pure units found in the source):
 *   1. ENABLE_PAYMENTS gate (payments.ts: isPaymentsDisabled) — fail-closed.
 *   2. HyperPay result-code classification (hyperpay.ts: SUCCESS_RE/PENDING_RE
 *      + classify) — success / pending / failed / null.
 *   3. Brand → payment_method mapping (hyperpay.ts: BRAND_TO_METHOD) —
 *      case-insensitive, unknown → null.
 *   4. Hosted-widget config builder (hyperpay.ts: widgetFor) — script URL shape,
 *      checkoutId URL-encoding, brand list.
 *   5. Gateway amount formatting (hyperpay.ts: amount.toFixed(2)).
 *   6. Mode → base-URL selection (hyperpay.ts: cfg) — live vs test host.
 *   7. Provider selection (provider.ts: getPaymentProvider) — PAYMENT_PROVIDER
 *      env, default + unknown → hyperpay.
 *   8. verifyWebhook is fail-closed (hyperpay.ts) — never claims authenticity.
 *
 * Mirrors the lib/checkout/__tests__/*.test.ts pattern: zero deps beyond Node's
 * built-in assert + the re-derived SUT.
 */

import { strict as assert } from 'node:assert';

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

// ════════════════════════════════════════════════════════════════════════════
// SUT re-derivation — mirrors the production source verbatim. Keep in sync with
// app/actions/payments.ts + lib/payments/{hyperpay,provider}.ts.
// ════════════════════════════════════════════════════════════════════════════

// --- app/actions/payments.ts: isPaymentsDisabled ---------------------------
// Reads the env at call time so a test can flip ENABLE_PAYMENTS per case.
function isPaymentsDisabled(): boolean {
  return process.env.ENABLE_PAYMENTS !== 'true';
}

// --- lib/payments/hyperpay.ts: result-code classification ------------------
type PaymentOutcome = 'success' | 'pending' | 'failed';

const SUCCESS_RE = /^(000\.000\.|000\.100\.1|000\.[36])/;
const PENDING_RE = /^(000\.200|800\.400\.5|100\.400\.500)/;

function classify(code: string | null): PaymentOutcome {
  if (!code) return 'failed';
  if (SUCCESS_RE.test(code)) return 'success';
  if (PENDING_RE.test(code)) return 'pending';
  return 'failed';
}

// --- lib/payments/hyperpay.ts: brand → payment_method ----------------------
const BRAND_TO_METHOD: Record<string, string> = {
  VISA: 'visa',
  MASTER: 'mastercard',
  MADA: 'mada',
  APPLEPAY: 'apple_pay',
  STC_PAY: 'stc_pay',
};

// How getPaymentStatus resolves the method from a raw paymentBrand.
function methodForBrand(paymentBrand: string | undefined): string | null {
  return paymentBrand
    ? (BRAND_TO_METHOD[paymentBrand.toUpperCase()] ?? null)
    : null;
}

// --- lib/payments/hyperpay.ts: hosted-widget config ------------------------
const WIDGET_BRANDS = ['VISA', 'MASTER', 'MADA', 'APPLEPAY'];

function widgetFor(base: string, checkoutId: string) {
  return {
    scriptUrl: `${base}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(checkoutId)}`,
    brands: WIDGET_BRANDS,
  };
}

// --- lib/payments/hyperpay.ts: cfg() mode → base URL -----------------------
function baseForMode(modeRaw: string | undefined): string {
  const mode = (modeRaw ?? 'test').trim().toLowerCase();
  return mode === 'live'
    ? 'https://eu-prod.oppwa.com'
    : 'https://eu-test.oppwa.com';
}

// --- lib/payments/hyperpay.ts: createCheckout amount formatting ------------
function gatewayAmount(amount: number): string {
  return amount.toFixed(2);
}

// --- lib/payments/provider.ts: getPaymentProvider name selection -----------
// The real factory returns a HyperPayProvider for 'hyperpay' AND for the
// default/unknown branch; here we assert on the resolved provider NAME.
function resolveProviderName(envValue: string | undefined): string {
  const name = (envValue ?? 'hyperpay').trim().toLowerCase();
  switch (name) {
    case 'hyperpay':
    default:
      return 'hyperpay';
  }
}

// --- lib/payments/hyperpay.ts: verifyWebhook (deferred, fail-closed) -------
function verifyWebhook(): { verified: boolean; reason?: string } {
  return {
    verified: false,
    reason: 'hyperpay_webhook_verifier_not_configured',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line no-console
console.log('[payment-core] running tests...');

// ────────────────────────────────────────────────────────────
// 1. ENABLE_PAYMENTS gate — fail-closed.
// ────────────────────────────────────────────────────────────
console.log('ENABLE_PAYMENTS gate');

test('disabled when ENABLE_PAYMENTS is unset', () => {
  const prev = process.env.ENABLE_PAYMENTS;
  delete process.env.ENABLE_PAYMENTS;
  try {
    assert.equal(isPaymentsDisabled(), true);
  } finally {
    if (prev === undefined) delete process.env.ENABLE_PAYMENTS;
    else process.env.ENABLE_PAYMENTS = prev;
  }
});

test('enabled ONLY for the exact string "true"', () => {
  const prev = process.env.ENABLE_PAYMENTS;
  try {
    process.env.ENABLE_PAYMENTS = 'true';
    assert.equal(isPaymentsDisabled(), false, '"true" must enable');
  } finally {
    if (prev === undefined) delete process.env.ENABLE_PAYMENTS;
    else process.env.ENABLE_PAYMENTS = prev;
  }
});

test('truthy-but-not-"true" values stay disabled (fail-closed)', () => {
  const prev = process.env.ENABLE_PAYMENTS;
  try {
    for (const v of ['TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']) {
      process.env.ENABLE_PAYMENTS = v;
      assert.equal(
        isPaymentsDisabled(),
        true,
        `value ${JSON.stringify(v)} must NOT enable payments`
      );
    }
  } finally {
    if (prev === undefined) delete process.env.ENABLE_PAYMENTS;
    else process.env.ENABLE_PAYMENTS = prev;
  }
});

// ────────────────────────────────────────────────────────────
// 2. HyperPay result-code classification.
// ────────────────────────────────────────────────────────────
console.log('result-code classification');

test('null / empty code → failed (no code is never a success)', () => {
  assert.equal(classify(null), 'failed');
  assert.equal(classify(''), 'failed');
});

test('canonical success codes → success', () => {
  // 000.000.* (success), 000.100.1* (successfully processed but in review-ish),
  // 000.3* / 000.6* families.
  for (const code of [
    '000.000.000',
    '000.100.110',
    '000.300.000',
    '000.600.000',
  ]) {
    assert.equal(classify(code), 'success', `${code} should be success`);
  }
});

test('canonical pending codes → pending', () => {
  for (const code of ['000.200.000', '800.400.500', '100.400.500']) {
    assert.equal(classify(code), 'pending', `${code} should be pending`);
  }
});

test('rejection / error codes → failed', () => {
  for (const code of [
    '800.100.100', // generic decline
    '100.100.101', // invalid card
    '000.400.101', // risk rejection (not 000.000/000.100.1/000.3/000.6)
    '000.100.200', // 000.100.2* is NOT in the success pattern
  ]) {
    assert.equal(classify(code), 'failed', `${code} should be failed`);
  }
});

test('success pattern is anchored at start (no substring match)', () => {
  // A success family appearing mid-string must not be treated as success.
  assert.equal(classify('999000.000.000'), 'failed');
  assert.equal(classify('x000.200.000'), 'failed');
});

// ────────────────────────────────────────────────────────────
// 3. Brand → payment_method mapping.
// ────────────────────────────────────────────────────────────
console.log('brand → payment_method');

test('known brands map to our payment_method enum', () => {
  assert.equal(methodForBrand('VISA'), 'visa');
  assert.equal(methodForBrand('MASTER'), 'mastercard');
  assert.equal(methodForBrand('MADA'), 'mada');
  assert.equal(methodForBrand('APPLEPAY'), 'apple_pay');
  assert.equal(methodForBrand('STC_PAY'), 'stc_pay');
});

test('brand matching is case-insensitive (upper-cased before lookup)', () => {
  assert.equal(methodForBrand('visa'), 'visa');
  assert.equal(methodForBrand('Master'), 'mastercard');
  assert.equal(methodForBrand('mAdA'), 'mada');
});

test('unknown brand → null (not a guess)', () => {
  assert.equal(methodForBrand('AMEX'), null);
  assert.equal(methodForBrand('DISCOVER'), null);
});

test('missing brand → null', () => {
  assert.equal(methodForBrand(undefined), null);
});

// ────────────────────────────────────────────────────────────
// 4. Hosted-widget config builder.
// ────────────────────────────────────────────────────────────
console.log('widget config');

test('builds the paymentWidgets.js URL for the checkout id', () => {
  const w = widgetFor('https://eu-test.oppwa.com', 'CHK_123');
  assert.equal(
    w.scriptUrl,
    'https://eu-test.oppwa.com/v1/paymentWidgets.js?checkoutId=CHK_123'
  );
});

test('checkout id is URL-encoded into the query', () => {
  const w = widgetFor('https://eu-test.oppwa.com', 'a b/c?d=e&f');
  assert.equal(
    w.scriptUrl,
    'https://eu-test.oppwa.com/v1/paymentWidgets.js?checkoutId=a%20b%2Fc%3Fd%3De%26f'
  );
});

test('widget exposes exactly the supported brand list', () => {
  const w = widgetFor('https://eu-prod.oppwa.com', 'X');
  assert.deepEqual(w.brands, ['VISA', 'MASTER', 'MADA', 'APPLEPAY']);
});

// ────────────────────────────────────────────────────────────
// 5. Gateway amount formatting.
// ────────────────────────────────────────────────────────────
console.log('amount formatting');

test('amount is sent with exactly 2 decimals', () => {
  assert.equal(gatewayAmount(45000), '45000.00');
  assert.equal(gatewayAmount(99.5), '99.50');
  assert.equal(gatewayAmount(0), '0.00');
});

test('fractional amounts round to 2 decimals (toFixed semantics)', () => {
  assert.equal(gatewayAmount(12.345), '12.35'); // round half up at this value
  assert.equal(gatewayAmount(12.344), '12.34');
});

// ────────────────────────────────────────────────────────────
// 6. Mode → base-URL selection.
// ────────────────────────────────────────────────────────────
console.log('mode → base URL');

test('live mode uses the production oppwa host', () => {
  assert.equal(baseForMode('live'), 'https://eu-prod.oppwa.com');
});

test('default / unset mode uses the test oppwa host (fail-safe to test)', () => {
  assert.equal(baseForMode(undefined), 'https://eu-test.oppwa.com');
  assert.equal(baseForMode('test'), 'https://eu-test.oppwa.com');
});

test('mode is trimmed + lower-cased', () => {
  assert.equal(baseForMode('  LIVE  '), 'https://eu-prod.oppwa.com');
  assert.equal(baseForMode('Test'), 'https://eu-test.oppwa.com');
});

test('any unrecognized mode falls back to the test host (not live)', () => {
  // Guards against accidentally hitting the live gateway on a typo'd env.
  assert.equal(baseForMode('production'), 'https://eu-test.oppwa.com');
  assert.equal(baseForMode('prod'), 'https://eu-test.oppwa.com');
});

// ────────────────────────────────────────────────────────────
// 7. Provider selection.
// ────────────────────────────────────────────────────────────
console.log('provider selection');

test('defaults to hyperpay when PAYMENT_PROVIDER is unset', () => {
  assert.equal(resolveProviderName(undefined), 'hyperpay');
});

test('selects hyperpay (case-insensitive, trimmed)', () => {
  assert.equal(resolveProviderName('hyperpay'), 'hyperpay');
  assert.equal(resolveProviderName('  HyperPay '), 'hyperpay');
});

test('unknown provider falls back to hyperpay (the default branch)', () => {
  assert.equal(resolveProviderName('moyasar'), 'hyperpay');
  assert.equal(resolveProviderName('stripe'), 'hyperpay');
});

// ────────────────────────────────────────────────────────────
// 8. verifyWebhook is fail-closed (deferred verifier).
// ────────────────────────────────────────────────────────────
console.log('webhook verification (deferred)');

test('verifyWebhook never claims authenticity until a real verifier ships', () => {
  const r = verifyWebhook();
  assert.equal(r.verified, false, 'unverified by design — status-lookup is truth');
  assert.equal(r.reason, 'hyperpay_webhook_verifier_not_configured');
});

// ────────────────────────────────────────────────────────────
// Final summary + exit code.
// ────────────────────────────────────────────────────────────
// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`[payment-core] ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
process.exit(0);
