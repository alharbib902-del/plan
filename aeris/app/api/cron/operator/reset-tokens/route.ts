import type { NextRequest } from 'next/server';

import { runOperatorCleanupCron } from '@/lib/operator/cron-cleanup';

/**
 * Phase 8 PR 2e — operator-password-reset-tokens cleanup cron.
 *
 * Schedule: every 6 hours (vercel.json). reset tokens have
 * a 30-min TTL and the table tends to stay small, but
 * unbounded growth from steady-state reset traffic still
 * justifies a regular sweep.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  return runOperatorCleanupCron(
    req,
    'cleanup_expired_password_reset_tokens'
  );
}
