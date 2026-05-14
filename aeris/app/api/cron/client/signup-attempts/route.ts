import type { NextRequest } from 'next/server';

import { runClientCleanupCron } from '@/lib/clients/cron-cleanup';

/**
 * Phase 9 PR 1 — client-signup-attempts cleanup cron.
 * Schedule: every 6h. Rate-limit window is 1h but the
 * cleanup retains 24h of history.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  return runClientCleanupCron(req, 'cleanup_old_client_signup_attempts');
}
