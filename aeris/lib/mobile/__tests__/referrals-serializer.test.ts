import assert from 'node:assert';

import {
  serializeReferralForMobile,
  referralShareUrl,
} from '@/lib/mobile/serializers/referrals';
import type { MyReferralRow } from '@/lib/clients/referrals';

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

test('referral row: exact allowlist — referee identity never leaks', () => {
  // Cast in referee identity fields to prove the serializer drops them
  // even if a future query widening selects them.
  const out = serializeReferralForMobile({
    id: 'ref-1',
    status: 'rewarded',
    referrer_reward_sar: 500,
    created_at: '2026-06-01T00:00:00Z',
    rewarded_at: '2026-06-10T00:00:00Z',
    referee_client_id: 'REFEREE_SECRET_ID',
    referee_name: 'REFEREE SECRET NAME',
    referee_email: 'referee@secret.example',
  } as unknown as MyReferralRow);
  assert.deepEqual(
    new Set(Object.keys(out)),
    new Set(['id', 'status', 'referrer_reward_sar', 'created_at', 'rewarded_at'])
  );
  const json = JSON.stringify(out);
  for (const s of ['REFEREE_SECRET_ID', 'REFEREE SECRET NAME', 'referee@secret.example']) {
    assert.ok(!json.includes(s), `referee identity leaked: ${s}`);
  }
});

test('reward is gated by status — only reported when rewarded', () => {
  // pre-reward: even a (hypothetical) non-null amount is withheld
  const pending = serializeReferralForMobile({
    id: 'ref-2',
    status: 'signed_up',
    referrer_reward_sar: 999,
    created_at: '2026-06-01T00:00:00Z',
    rewarded_at: null,
  } as MyReferralRow);
  assert.equal(pending.referrer_reward_sar, null);
  assert.equal(pending.rewarded_at, null);
  // rewarded: the amount is reported
  const done = serializeReferralForMobile({
    id: 'ref-3',
    status: 'rewarded',
    referrer_reward_sar: 500,
    created_at: '2026-06-01T00:00:00Z',
    rewarded_at: '2026-06-10T00:00:00Z',
  } as MyReferralRow);
  assert.equal(done.referrer_reward_sar, 500);
});

test('share url mirrors the web: /signup?ref=<encoded code>', () => {
  assert.equal(
    referralShareUrl('https://aeris.sa', 'AB12CD'),
    'https://aeris.sa/signup?ref=AB12CD'
  );
  // encodes unsafe chars defensively
  assert.equal(
    referralShareUrl('https://aeris.sa', 'a b/c&x'),
    'https://aeris.sa/signup?ref=a%20b%2Fc%26x'
  );
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
