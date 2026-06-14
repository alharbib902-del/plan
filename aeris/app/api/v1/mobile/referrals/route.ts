import { NextResponse } from 'next/server';

import {
  getOrCreateReferralCode,
  listMyReferrals,
} from '@/lib/clients/referrals';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import {
  serializeReferralForMobile,
  referralShareUrl,
} from '@/lib/mobile/serializers/referrals';

/**
 * GET /api/v1/mobile/referrals  (AUTHED)
 *
 * The client's referral code (get-or-create, idempotent) + share link +
 * their own referrals. Referrals are NOT flag-gated (per CLAUDE.md), so
 * only requireClientBearer (ENABLE_CLIENT_PORTAL + password lock) applies.
 * getOrCreateReferralCode returns null on RPC failure (soft "try later");
 * listMyReferrals throws → rpc_failed. Referee identity is never exposed.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function siteUrl(): string {
  // Strip a trailing slash to mirror the web's siteBaseUrl() exactly
  // (avoids `https://aeris.sa//signup?ref=...` if the env has a trailing /).
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa').replace(
    /\/$/,
    ''
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  let code: string | null;
  let referrals: Awaited<ReturnType<typeof listMyReferrals>>;
  try {
    [code, referrals] = await Promise.all([
      getOrCreateReferralCode(auth.session.client_id),
      listMyReferrals(auth.session.client_id),
    ]);
  } catch (err) {
    console.error('[mobile.referrals] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({
      code,
      share_url: code ? referralShareUrl(siteUrl(), code) : null,
      referrals: referrals.map(serializeReferralForMobile),
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
