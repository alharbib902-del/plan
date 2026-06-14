import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { listAvailableEmptyLegs } from '@/lib/clients/queries/me-empty-legs';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeEmptyLegForMobile } from '@/lib/mobile/serializers/empty-legs';

/**
 * GET /api/v1/mobile/empty-legs  (AUTHED)
 *
 * Browse-all for the signed-in client. Gated by
 * ENABLE_CLIENT_EMPTY_LEGS_PORTAL (the client empty-legs feature)
 * on top of requireClientBearer's ENABLE_CLIENT_PORTAL.
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

  let legs: Awaited<ReturnType<typeof listAvailableEmptyLegs>>;
  try {
    legs = await listAvailableEmptyLegs();
  } catch (err) {
    console.error('[mobile.empty-legs.list] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({
      pricing_visible: clientPricingVisible(),
      legs: legs.map((row) =>
        serializeEmptyLegForMobile(row, { viewerClientId: auth.session.client_id })
      ),
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
