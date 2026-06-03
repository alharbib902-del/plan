import assert from 'node:assert/strict';

import { captureCronError } from '../operational';

/**
 * REA-01 — `captureCronError` no-op safety. With no DSN configured Sentry is
 * disabled and never initialized, so the helper must be a safe no-op: its
 * promise must resolve without throwing and without taking the flush path
 * (which only runs when a DSN is set). The real capture + flush path is
 * exercised by the SDK's own integration tests, not here.
 */

delete process.env.NEXT_PUBLIC_SENTRY_DSN;
delete process.env.SENTRY_DSN;

async function run() {
  const p = captureCronError('test.cron', new Error('boom'), { id: 1 });
  assert.ok(p instanceof Promise);
  await p;
  await captureCronError('test.cron', 'string-error');
  await captureCronError('test.cron', undefined);
  console.log('operational.test: all assertions passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
