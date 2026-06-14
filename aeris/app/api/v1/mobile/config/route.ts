import { NextResponse } from 'next/server';

import { mobileConfig } from '@/lib/config/feature-flags';
import { mobileOk, mobilePreflight, withCors } from '@/lib/mobile/http';

/**
 * GET /api/v1/mobile/config
 *
 * Public (no token). Returns the deployed capability flags +
 * price visibility + minimum supported app version so a
 * published Flutter client can adapt to flag flips in Vercel
 * WITHOUT a store release, and `/config` fail-closed on the app
 * side (FLUTTER-APP-PLAN.md §5 S9): if the app can't reach this,
 * it treats every feature-gated path as OFF.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export function GET(req: Request): NextResponse {
  return withCors(req, mobileOk({ ...mobileConfig() }));
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
