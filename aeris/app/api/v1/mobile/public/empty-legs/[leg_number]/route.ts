import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import { getPublicLegByNumber } from '@/lib/empty-legs/public-queries';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeEmptyLegForMobile } from '@/lib/mobile/serializers/empty-legs';

/**
 * GET /api/v1/mobile/public/empty-legs/[leg_number]  (GUEST)
 *
 * Detail for a shared `EL-XXXX` link. Surfaces terminal states
 * (sold/expired) + reserved so a stale link renders meaningfully
 * rather than 404. Reserver PII is stripped by the serializer.
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
  if (!flagOn('ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE')) {
    return withCors(req, mobileError('flag_disabled'));
  }

  const { leg_number } = await params;
  let leg: Awaited<ReturnType<typeof getPublicLegByNumber>>;
  try {
    leg = await getPublicLegByNumber(leg_number, {
      allowedStatuses: ['available', 'reserved', 'sold', 'expired'],
    });
  } catch (err) {
    console.error('[mobile.public.empty-legs.detail] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }
  if (!leg) return withCors(req, mobileError('leg_not_found'));

  return withCors(
    req,
    mobileOk({ leg: serializeEmptyLegForMobile(leg, { viewerClientId: null }) })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
