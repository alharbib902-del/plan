import { NextResponse } from 'next/server';

import { runClientLogout } from '@/lib/clients/core/auth-core';
import { extractBearerToken } from '@/lib/mobile/auth';
import { mobileOk, mobilePreflight, withCors } from '@/lib/mobile/http';

/**
 * POST /api/v1/mobile/auth/logout
 *
 * Revokes the presented Bearer token's session (idempotent).
 * Deliberately does NOT gate on the portal flag or require a
 * still-valid session: logout must ALWAYS succeed so the app
 * can wipe its stored token even if the session was already
 * revoked or the portal was turned off. The app deletes the
 * token from secure storage on `ok`.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  await runClientLogout(extractBearerToken(req));
  return withCors(req, mobileOk());
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
