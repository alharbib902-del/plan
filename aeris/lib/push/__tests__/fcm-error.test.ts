// Push PR3b — unit tests for FCM result classification + backoff + aggregation.
// Layer-1 (no DB/network). Runs as `npm run test:push-fcm-error`.

import { strict as assert } from 'node:assert';

import {
  aggregateDeliveryStatus,
  classifyFcmResult,
  nextRetryAt,
} from '@/lib/push/fcm-error';

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

const tokenViolation = {
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: [{ field: 'message.token', description: 'Invalid registration' }],
      },
    ],
  },
};
const payloadViolation = {
  error: {
    code: 400,
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: [{ field: 'message.notification.title', description: 'bad' }],
      },
    ],
  },
};
const unregistered = {
  error: {
    code: 404,
    status: 'NOT_FOUND',
    details: [
      { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' },
    ],
  },
};

test('200 → success', () => assert.equal(classifyFcmResult(200, null), 'success'));
test('401 / 403 → config (never delete on a creds error)', () => {
  assert.equal(classifyFcmResult(401, null), 'config');
  assert.equal(classifyFcmResult(403, null), 'config');
});
test('404 → delete', () => assert.equal(classifyFcmResult(404, null), 'delete'));
test('UNREGISTERED detail → delete', () =>
  assert.equal(classifyFcmResult(404, unregistered), 'delete'));
test('INVALID_ARGUMENT w/ TOKEN field-violation → delete', () =>
  assert.equal(classifyFcmResult(400, tokenViolation), 'delete'));
test('INVALID_ARGUMENT w/ PAYLOAD field-violation → transient (no delete)', () =>
  assert.equal(classifyFcmResult(400, payloadViolation), 'transient'));
test('INVALID_ARGUMENT w/ a payload field merely ENDING in .token → transient', () => {
  const deepTokenField = {
    error: {
      status: 'INVALID_ARGUMENT',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.BadRequest',
          fieldViolations: [{ field: 'message.data.token', description: 'x' }],
        },
      ],
    },
  };
  // exact-match only: a nested data.token is NOT the registration token.
  assert.equal(classifyFcmResult(400, deepTokenField), 'transient');
});
test('bare INVALID_ARGUMENT (no token detail) → transient', () =>
  assert.equal(
    classifyFcmResult(400, { error: { status: 'INVALID_ARGUMENT' } }),
    'transient'
  ));
test('429 / 503 / 500 → transient', () => {
  assert.equal(classifyFcmResult(429, null), 'transient');
  assert.equal(classifyFcmResult(503, null), 'transient');
  assert.equal(classifyFcmResult(500, null), 'transient');
});

test('backoff: 5m / 20m / capped at 6h', () => {
  const now = new Date('2026-06-17T00:00:00.000Z');
  assert.equal(nextRetryAt(1, now), '2026-06-17T00:05:00.000Z');
  assert.equal(nextRetryAt(3, now), '2026-06-17T00:20:00.000Z');
  assert.equal(nextRetryAt(100, now), '2026-06-17T06:00:00.000Z');
});

test('aggregate: any success → sent', () => {
  assert.deepEqual(aggregateDeliveryStatus(['delete', 'success']), {
    markStatus: 'sent',
    configMissing: false,
  });
});
test('aggregate: config (no success) → failed_transient + configMissing', () => {
  assert.deepEqual(aggregateDeliveryStatus(['config', 'transient']), {
    markStatus: 'failed_transient',
    configMissing: true,
  });
});
test('aggregate: transient (no success/config) → failed_transient', () => {
  assert.deepEqual(aggregateDeliveryStatus(['transient', 'delete']), {
    markStatus: 'failed_transient',
    configMissing: false,
  });
});
test('aggregate: all delete → failed_permanent', () => {
  assert.deepEqual(aggregateDeliveryStatus(['delete', 'delete']), {
    markStatus: 'failed_permanent',
    configMissing: false,
  });
});

// eslint-disable-next-line no-console
console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
