// Push PR1 — unit tests for the device-token registration validator.
// Layer-1 (no DB). Runs as `npm run test:push-device-tokens`.

import { strict as assert } from 'node:assert';

import {
  deviceTokenRegisterSchema,
  deviceTokenUnregisterSchema,
} from '@/lib/validators/clients';

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

test('accepts a valid ios / android registration', () => {
  const ios = deviceTokenRegisterSchema.safeParse({
    token: 'abc123',
    platform: 'ios',
  });
  assert.equal(ios.success, true);
  const android = deviceTokenRegisterSchema.safeParse({
    token: 'def456',
    platform: 'android',
  });
  assert.equal(android.success, true);
});

test('trims the token', () => {
  const r = deviceTokenRegisterSchema.safeParse({
    token: '  tok  ',
    platform: 'ios',
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.token, 'tok');
});

test('rejects an unknown platform', () => {
  const r = deviceTokenRegisterSchema.safeParse({
    token: 'tok',
    platform: 'web',
  });
  assert.equal(r.success, false);
});

test('rejects an empty / whitespace-only token', () => {
  assert.equal(
    deviceTokenRegisterSchema.safeParse({ token: '', platform: 'ios' }).success,
    false
  );
  assert.equal(
    deviceTokenRegisterSchema.safeParse({ token: '   ', platform: 'ios' })
      .success,
    false
  );
});

test('rejects a missing platform', () => {
  assert.equal(
    deviceTokenRegisterSchema.safeParse({ token: 'tok' }).success,
    false
  );
});

test('rejects unknown keys (.strict)', () => {
  assert.equal(
    deviceTokenRegisterSchema.safeParse({
      token: 'tok',
      platform: 'ios',
      rogue: true,
    }).success,
    false
  );
});

test('rejects an over-long token (> 4096)', () => {
  assert.equal(
    deviceTokenRegisterSchema.safeParse({
      token: 'x'.repeat(4097),
      platform: 'android',
    }).success,
    false
  );
});

test('unregister schema: token-only, trimmed, strict (no query-string token)',
  () => {
    const ok = deviceTokenUnregisterSchema.safeParse({ token: '  tok  ' });
    assert.equal(ok.success, true);
    if (ok.success) assert.equal(ok.data.token, 'tok');
    // empty / missing / unknown-key / platform-leak all rejected
    assert.equal(
      deviceTokenUnregisterSchema.safeParse({ token: '' }).success,
      false
    );
    assert.equal(deviceTokenUnregisterSchema.safeParse({}).success, false);
    assert.equal(
      deviceTokenUnregisterSchema.safeParse({ token: 'tok', platform: 'ios' })
        .success,
      false
    );
  });

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
