import type { NextRequest } from 'next/server';

import { runOperatorCleanupCron } from '@/lib/operator/cron-cleanup';

/**
 * Phase 8 PR 2e — operator-signup-attempts cleanup cron.
 *
 * Schedule: every 6 hours (vercel.json). The rate-limit
 * window itself is 1 hour, but the canary readout looks
 * at a 24-hour window so the cleanup deliberately retains
 * 24 hours of history even though only the last 60 minutes
 * gate further signups.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  return runOperatorCleanupCron(req, 'cleanup_old_signup_attempts');
}
