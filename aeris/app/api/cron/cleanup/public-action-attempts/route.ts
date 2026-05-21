import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  unauthorizedJsonResponse,
  verifyCronAuth,
} from '@/lib/empty-legs/cron-auth';

/**
 * Daily cleanup of public_action_attempts (>7 days old).
 *
 * Calls cleanup_old_public_action_attempts() RPC. The rate-limit
 * windows are max 1h, so retaining 7 days gives the founder a
 * triage buffer without unbounded growth on the table.
 *
 * Schedule: once per day at 05:00 UTC (after the privilege crons
 * at 03:00/04:00 to avoid bunching).
 *
 * Auth: shared verifyCronAuth helper.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type LooseClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function GET(req: NextRequest): Promise<Response> {
  const auth = verifyCronAuth(req.headers);
  if (!auth.ok) {
    return unauthorizedJsonResponse();
  }

  const client = createAdminClient() as unknown as LooseClient;
  const { data, error } = await client.rpc(
    'cleanup_old_public_action_attempts',
    {}
  );

  if (error) {
    console.error('[cron.cleanup.public-action-attempts] rpc error', error);
    return NextResponse.json(
      { ok: false, error: 'rpc_failed' },
      { status: 200 }
    );
  }

  const deleted = typeof data === 'number' ? data : 0;
  return NextResponse.json(
    { ok: true, deleted },
    { status: 200 }
  );
}
