import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { getEmptyLegByNumber } from '@/lib/clients/queries/me-empty-legs';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeEmptyLegForMobile } from '@/lib/mobile/serializers/empty-legs';

/**
 * GET /api/v1/mobile/empty-legs/[leg_number]  (AUTHED)
 *
 * Detail by `EL-XXXX`. The serialized body includes `id` (the
 * leg UUID) which the app passes to POST /empty-legs/reserve.
 * (Single dynamic slug `leg_number` here; reserve/release take
 * leg_id in the body to avoid a Next mixed-slug-name conflict.)
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ leg_number: string }>;
}

export async function GET(
  req: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);
  if (!flagOn('ENABLE_CLIENT_EMPTY_LEGS_PORTAL')) {
    return withCors(req, mobileError('flag_disabled'));
  }

  const { leg_number } = await params;
  let leg: Awaited<ReturnType<typeof getEmptyLegByNumber>>;
  try {
    leg = await getEmptyLegByNumber(leg_number);
  } catch (err) {
    console.error('[mobile.empty-legs.detail] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }
  if (!leg) return withCors(req, mobileError('leg_not_found'));

  return withCors(
    req,
    mobileOk({
      pricing_visible: clientPricingVisible(),
      leg: serializeEmptyLegForMobile(leg, {
        viewerClientId: auth.session.client_id,
      }),
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
