import type { NextRequest } from 'next/server';

import { runOperatorCleanupCron } from '@/lib/operator/cron-cleanup';

/**
 * Phase 8 PR 2e — operator-otp-codes cleanup cron.
 *
 * Schedule: every 30 minutes (vercel.json). OTP TTL is
 * 10 minutes — the shortest of any Phase 8 token surface
 * — so under steady admin recovery traffic the table
 * accumulates rows quickly. The 30-min cadence keeps the
 * row count tight without wasting cron quota.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  return runOperatorCleanupCron(req, 'cleanup_expired_otp_codes');
}
