import type { NextRequest } from 'next/server';

import { runClientCleanupCron } from '@/lib/clients/cron-cleanup';

/**
 * Phase 9 PR 1 — client-password-reset-tokens cleanup cron.
 * Schedule: every 6h. Reset tokens have 30-min TTL.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<Response> {
  return runClientCleanupCron(
    req,
    'cleanup_expired_client_password_reset_tokens'
  );
}
