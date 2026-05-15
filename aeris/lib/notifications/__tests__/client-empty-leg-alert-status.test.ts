/**
 * Phase 10 PR 1 — alert-singleton write contract test.
 *
 * Layer-1 (no DB): mocks the AdminClient + asserts that
 * `recordClientEmptyLegAlertStatus` produces the correct UPDATE
 * payload for both success and failure cases (round 7 P1 #2).
 *
 * The §3.6 singleton covers BOTH match-email and reservation-email
 * surfaces; the contextLabel argument identifies which is the
 * broken channel for `last_failure_reason`.
 *
 * Runs as: npm run test:notifications-client-empty-leg-alert-status
 */

import { strict as assert } from 'node:assert';

import { recordClientEmptyLegAlertStatus } from '@/lib/notifications/client-empty-leg-alert-status';
import type { ClientEmailDeliveryResult } from '@/lib/notifications/client-email';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): Promise<void> {
  return fn()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.log(`  ✗ ${name}`);
      // eslint-disable-next-line no-console
      console.log(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

// eslint-disable-next-line no-console
console.log('\n[client-empty-leg-alert-status] running …\n');

interface CapturedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filterKey: string;
  filterValue: unknown;
}

function makeMockClient(): {
  client: Parameters<typeof recordClientEmptyLegAlertStatus>[0];
  captured: CapturedUpdate[];
} {
  const captured: CapturedUpdate[] = [];

  const fakeClient = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(filterKey: string, filterValue: unknown) {
              captured.push({ table, payload, filterKey, filterValue });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof recordClientEmptyLegAlertStatus>[0];

  return { client: fakeClient, captured };
}

// ============================================================

(async () => {
  await test('success → flips status to healthy', async () => {
    const { client, captured } = makeMockClient();
    const result: ClientEmailDeliveryResult = {
      ok: true,
      message_id: 'msg_123',
    };
    await recordClientEmptyLegAlertStatus(
      client,
      result,
      'empty-leg-match:new_leg'
    );
    assert.equal(captured.length, 1);
    const c = captured[0]!;
    assert.equal(c.table, 'client_empty_leg_alert_status');
    assert.equal(c.payload.status, 'healthy');
    assert.equal(c.filterKey, 'id');
    assert.equal(c.filterValue, 1);
  });

  await test('env_missing failure → flips to config_missing', async () => {
    const { client, captured } = makeMockClient();
    const result: ClientEmailDeliveryResult = {
      ok: false,
      reason: 'env_missing',
      detail: 'RESEND_API_KEY missing',
    };
    await recordClientEmptyLegAlertStatus(
      client,
      result,
      'empty-leg-match:new_leg'
    );
    const c = captured[0]!;
    assert.equal(c.payload.status, 'config_missing');
    assert.ok(
      typeof c.payload.last_failure_reason === 'string' &&
        c.payload.last_failure_reason.includes('env_missing'),
      `expected last_failure_reason to mention env_missing`
    );
  });

  await test('send_failed → flips to send_failed', async () => {
    const { client, captured } = makeMockClient();
    const result: ClientEmailDeliveryResult = {
      ok: false,
      reason: 'send_failed',
      detail: 'Resend API 500',
    };
    await recordClientEmptyLegAlertStatus(
      client,
      result,
      'empty-leg-reservation:confirm'
    );
    const c = captured[0]!;
    assert.equal(c.payload.status, 'send_failed');
    assert.ok(
      typeof c.payload.last_failure_reason === 'string' &&
        c.payload.last_failure_reason.includes(
          'empty-leg-reservation:confirm'
        ),
      `last_failure_reason should include the contextLabel`
    );
  });

  await test('match-email contextLabel routes to same singleton', async () => {
    const { client, captured } = makeMockClient();
    await recordClientEmptyLegAlertStatus(
      client,
      { ok: true, message_id: null },
      'empty-leg-match:price_dropped'
    );
    assert.equal(captured[0]!.table, 'client_empty_leg_alert_status');
  });

  await test('reservation-email contextLabel routes to same singleton', async () => {
    const { client, captured } = makeMockClient();
    await recordClientEmptyLegAlertStatus(
      client,
      { ok: true, message_id: null },
      'empty-leg-reservation:confirm'
    );
    // Round 7 P1 #2: SAME singleton covers both surfaces.
    assert.equal(captured[0]!.table, 'client_empty_leg_alert_status');
  });

  // eslint-disable-next-line no-console
  console.log(
    `\n[client-empty-leg-alert-status] ${passed} passed, ${failed} failed\n`
  );

  if (failed > 0) {
    process.exit(1);
  }
})();
