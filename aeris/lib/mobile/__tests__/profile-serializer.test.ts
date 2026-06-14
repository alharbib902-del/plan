import assert from 'node:assert';

import { mapClientProfileRow } from '@/lib/mobile/serializers/profile';

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

test('maps a full row', () => {
  const out = mapClientProfileRow({
    full_name: 'محمد',
    contact_phone: '+966500000000',
    auth_email: 'm@example.com',
    marketing_opt_in: true,
  });
  assert.equal(out.full_name, 'محمد');
  assert.equal(out.contact_phone, '+966500000000');
  assert.equal(out.auth_email, 'm@example.com');
  assert.equal(out.marketing_opt_in, true);
});

test('null-coalesces missing values', () => {
  const out = mapClientProfileRow({
    full_name: null,
    contact_phone: null,
    auth_email: null,
    marketing_opt_in: null,
  });
  assert.equal(out.full_name, '');
  assert.equal(out.contact_phone, '');
  assert.equal(out.auth_email, '');
  assert.equal(out.marketing_opt_in, false);
});

test('output is EXACTLY the 4-field allowlist — extra row columns never leak', () => {
  const out = mapClientProfileRow({
    full_name: 'X',
    contact_phone: 'Y',
    auth_email: 'Z',
    marketing_opt_in: false,
    password_hash: '$2b$12$SECRET',
    privilege_tier: 'diamond',
    cashback_balance_sar: 99999,
  } as Parameters<typeof mapClientProfileRow>[0]);
  assert.deepEqual(
    new Set(Object.keys(out)),
    new Set(['full_name', 'contact_phone', 'auth_email', 'marketing_opt_in'])
  );
  const json = JSON.stringify(out);
  assert.ok(!json.includes('SECRET'), 'password_hash must never leak');
  assert.ok(!json.includes('diamond'), 'privilege_tier must never leak');
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
