import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { listMatchedEmptyLegsForClient } from '@/lib/clients/queries/me-empty-legs';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeMatchedLegForMobile } from '@/lib/mobile/serializers/empty-legs';

/**
 * GET /api/v1/mobile/empty-legs/matches  (AUTHED)
 *
 * The "my matches" tab — legs the matcher notified this client
 * about (empty_leg_notifications keyed on client_id).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);
  if (!flagOn('ENABLE_CLIENT_EMPTY_LEGS_PORTAL')) {
    return withCors(req, mobileError('flag_disabled'));
  }

  let matches: Awaited<ReturnType<typeof listMatchedEmptyLegsForClient>>;
  try {
    matches = await listMatchedEmptyLegsForClient(auth.session.client_id);
  } catch (err) {
    console.error('[mobile.empty-legs.matches] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({
      pricing_visible: clientPricingVisible(),
      matches: matches.map((entry) =>
        serializeMatchedLegForMobile(entry, {
          viewerClientId: auth.session.client_id,
        })
      ),
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
