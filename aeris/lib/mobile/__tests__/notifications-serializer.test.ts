import assert from 'node:assert';

import { mapNotificationPreferences } from '@/lib/mobile/serializers/notifications';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

test('null prefs → everything opt-in (Decision #4 default)', () => {
  const out = mapNotificationPreferences(null);
  assert.deepEqual(out, {
    empty_legs: { email: true, wa_link: true },
    marketing: true,
  });
});

test('empty object → opt-in', () => {
  const out = mapNotificationPreferences({});
  assert.equal(out.empty_legs.email, true);
  assert.equal(out.empty_legs.wa_link, true);
  assert.equal(out.marketing, true);
});

test('explicit false is respected per channel + marketing', () => {
  const out = mapNotificationPreferences({
    empty_legs: { email: false, wa_link: true },
    marketing: false,
  });
  assert.equal(out.empty_legs.email, false);
  assert.equal(out.empty_legs.wa_link, true);
  assert.equal(out.marketing, false);
});

test('non-boolean / polluted channel value → opt-out (defensive)', () => {
  const out = mapNotificationPreferences({
    empty_legs: { email: 'yes', wa_link: 1 },
  });
  assert.equal(out.empty_legs.email, false);
  assert.equal(out.empty_legs.wa_link, false);
});

test('non-boolean marketing value → opt-out (defensive, symmetric with channels)', () => {
  // Only absent / explicit true opt in; explicit false OR any polluted
  // non-boolean (legacy/forged JSONB) → opt-out (higher-risk consent
  // must never stay on by accident).
  for (const bad of ['false', 0, null, {}, 'no']) {
    assert.equal(
      mapNotificationPreferences({
        marketing: bad,
      } as Parameters<typeof mapNotificationPreferences>[0]).marketing,
      false,
      `marketing=${JSON.stringify(bad)} must be opt-out`
    );
  }
  // sanity: explicit true + absent still opt-in
  assert.equal(mapNotificationPreferences({ marketing: true }).marketing, true);
  assert.equal(mapNotificationPreferences({}).marketing, true);
});

test('output shape is exactly {empty_legs:{email,wa_link}, marketing}', () => {
  const out = mapNotificationPreferences({
    empty_legs: { email: true, wa_link: false },
    marketing: true,
    junk: 'should be dropped',
  } as Parameters<typeof mapNotificationPreferences>[0]);
  assert.deepEqual(new Set(Object.keys(out)), new Set(['empty_legs', 'marketing']));
  assert.deepEqual(
    new Set(Object.keys(out.empty_legs)),
    new Set(['email', 'wa_link'])
  );
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
