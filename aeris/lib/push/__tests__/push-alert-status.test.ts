// Push PR3a — unit tests for the client_push_alert_status singleton helper.
// Layer-1 (no DB): a fake admin client captures the .update() payload.
// Runs as `npm run test:push-alert-status`.

import { strict as assert } from 'node:assert';

import type { createAdminClient } from '@/lib/supabase/admin';
import { recordClientPushAlertStatus } from '@/lib/push/push-alert-status';

type AdminClient = ReturnType<typeof createAdminClient>;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
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

interface Captured {
  table: string;
  payload: Record<string, unknown>;
  eqCol: string;
  eqVal: unknown;
}

function fakeAdmin(): { client: AdminClient; calls: Captured[] } {
  const calls: Captured[] = [];
  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          return {
            eq(eqCol: string, eqVal: unknown) {
              calls.push({ table, payload, eqCol, eqVal });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as AdminClient;
  return { client, calls };
}

async function run(): Promise<void> {
  await test('success → status healthy on the id=1 singleton', async () => {
    const { client, calls } = fakeAdmin();
    await recordClientPushAlertStatus(client, { ok: true }, 'ctx');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, 'client_push_alert_status');
    assert.equal(calls[0].payload.status, 'healthy');
    assert.equal(calls[0].eqCol, 'id');
    assert.equal(calls[0].eqVal, 1);
  });

  await test('config_missing → status config_missing + reason carries context', async () => {
    const { client, calls } = fakeAdmin();
    await recordClientPushAlertStatus(
      client,
      { ok: false, reason: 'config_missing', detail: 'no creds' },
      'empty-leg-push:published'
    );
    assert.equal(calls[0].payload.status, 'config_missing');
    assert.match(
      String(calls[0].payload.last_failure_reason),
      /empty-leg-push:published.*config_missing.*no creds/
    );
  });

  await test('send_failed → status send_failed', async () => {
    const { client, calls } = fakeAdmin();
    await recordClientPushAlertStatus(
      client,
      { ok: false, reason: 'send_failed', detail: 'FCM 503' },
      'ctx'
    );
    assert.equal(calls[0].payload.status, 'send_failed');
  });

  // eslint-disable-next-line no-console
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void run();
