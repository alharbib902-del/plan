// Push PR3b — unit tests for the empty-leg push templates (Arabic, no PII,
// pricing only when visible). Runs as `npm run test:push-templates`.

import { strict as assert } from 'node:assert';

import { buildEmptyLegPushTemplate } from '@/lib/push/push-templates';

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

test('published: title + route body, no price when pricing hidden', () => {
  const t = buildEmptyLegPushTemplate({
    eventType: 'published',
    routeFrom: 'الرياض',
    routeTo: 'جدة',
    currentPrice: 60000,
    includePricing: false,
  });
  assert.equal(t.title, 'رحلة فارغة جديدة');
  assert.equal(t.body, 'الرياض → جدة');
  assert.ok(!t.body.includes('ريال'));
});

test('price_dropped: distinct title', () => {
  const t = buildEmptyLegPushTemplate({
    eventType: 'price_dropped',
    routeFrom: 'RUH',
    routeTo: 'JED',
    currentPrice: 50000,
    includePricing: false,
  });
  assert.equal(t.title, 'انخفض سعر رحلة فارغة');
  assert.equal(t.body, 'RUH → JED');
});

test('price shown ONLY when includePricing + a positive price', () => {
  const withPrice = buildEmptyLegPushTemplate({
    eventType: 'published',
    routeFrom: 'RUH',
    routeTo: 'JED',
    currentPrice: 60000,
    includePricing: true,
  });
  assert.equal(withPrice.body, 'RUH → JED — 60,000 ريال');

  // includePricing but no/zero price → no suffix (defensive).
  for (const p of [null, 0, -5, undefined]) {
    const t = buildEmptyLegPushTemplate({
      eventType: 'published',
      routeFrom: 'RUH',
      routeTo: 'JED',
      currentPrice: p as number | null | undefined,
      includePricing: true,
    });
    assert.equal(t.body, 'RUH → JED', `price=${String(p)} must add no suffix`);
  }
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
