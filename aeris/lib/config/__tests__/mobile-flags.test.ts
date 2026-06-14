/**
 * Phase 0 (mobile API) — unit tests for the capability-flag
 * reads exposed by GET /api/v1/mobile/config.
 *
 * Layer-1 (no DB). Runs as `npm run test:mobile-flags`.
 *
 * Pins the fail-closed semantics (ONLY the literal 'true' is on)
 * and the /config payload shape the app adapts to.
 */

import { strict as assert } from 'node:assert';

import {
  flagOn,
  mobileCapabilityFlags,
  mobileConfig,
} from '@/lib/config/feature-flags';

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

const FLAG_VARS = [
  'ENABLE_CLIENT_PORTAL',
  'ENABLE_PRIVILEGE',
  'ENABLE_PAYMENTS',
  'ENABLE_CLIENT_EMPTY_LEGS_PORTAL',
  'ENABLE_EMPTY_LEGS_CLIENT_PRICING',
  'MOBILE_MIN_SUPPORTED_VERSION',
];

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of FLAG_VARS) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const k of FLAG_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('flagOn is true ONLY for the literal "true"', () => {
  withEnv({ ENABLE_CLIENT_PORTAL: 'true' }, () =>
    assert.equal(flagOn('ENABLE_CLIENT_PORTAL'), true)
  );
  withEnv({ ENABLE_CLIENT_PORTAL: 'false' }, () =>
    assert.equal(flagOn('ENABLE_CLIENT_PORTAL'), false)
  );
  withEnv({ ENABLE_CLIENT_PORTAL: '1' }, () =>
    assert.equal(flagOn('ENABLE_CLIENT_PORTAL'), false)
  );
  withEnv({ ENABLE_CLIENT_PORTAL: undefined }, () =>
    assert.equal(flagOn('ENABLE_CLIENT_PORTAL'), false)
  );
});

test('mobileCapabilityFlags reflects each flag independently', () => {
  withEnv(
    {
      ENABLE_CLIENT_PORTAL: 'true',
      ENABLE_PRIVILEGE: 'true',
      ENABLE_PAYMENTS: undefined,
      ENABLE_CLIENT_EMPTY_LEGS_PORTAL: 'false',
      ENABLE_EMPTY_LEGS_CLIENT_PRICING: 'true',
    },
    () => {
      const f = mobileCapabilityFlags();
      assert.equal(f.client_portal, true);
      assert.equal(f.privilege, true);
      assert.equal(f.payments, false);
      assert.equal(f.client_empty_legs_portal, false);
      assert.equal(f.empty_legs_client_pricing, true);
    }
  );
});

test('mobileConfig.pricing_visible follows the pricing flag', () => {
  withEnv({ ENABLE_EMPTY_LEGS_CLIENT_PRICING: 'true' }, () =>
    assert.equal(mobileConfig().pricing_visible, true)
  );
  withEnv({ ENABLE_EMPTY_LEGS_CLIENT_PRICING: undefined }, () =>
    assert.equal(mobileConfig().pricing_visible, false)
  );
});

test('mobileConfig.min_supported_version defaults to 1.0.0 and is overridable', () => {
  withEnv({ MOBILE_MIN_SUPPORTED_VERSION: undefined }, () =>
    assert.equal(mobileConfig().min_supported_version, '1.0.0')
  );
  withEnv({ MOBILE_MIN_SUPPORTED_VERSION: '2.3.1' }, () =>
    assert.equal(mobileConfig().min_supported_version, '2.3.1')
  );
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
