import type { NextRequest } from 'next/server';

import { runOperatorCleanupCron } from '@/lib/operator/cron-cleanup';

/**
 * Phase 8 PR 2e — operator-sessions cleanup cron.
 *
 * Schedule: every 6 hours (vercel.json). Safe cadence
 * because operator_sessions.expires_at is 7-30 days and
 * the LOOKUP path already rejects expired hashes; cleanup
 * is a retention-only concern.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  return runOperatorCleanupCron(req, 'cleanup_expired_operator_sessions');
}
