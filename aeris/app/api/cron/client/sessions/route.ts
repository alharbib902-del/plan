import type { NextRequest } from 'next/server';

import { runClientCleanupCron } from '@/lib/clients/cron-cleanup';

/**
 * Phase 9 PR 1 — client-sessions cleanup cron.
 *
 * Schedule: every 6 hours (vercel.json). Same cadence
 * rationale as the operator-side equivalent — sessions
 * have 7-30 day TTL; cleanup is retention only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  return runClientCleanupCron(req, 'cleanup_expired_client_sessions');
}
