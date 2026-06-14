import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { listPublicAvailableLegs } from '@/lib/empty-legs/public-queries';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeEmptyLegForMobile } from '@/lib/mobile/serializers/empty-legs';

/**
 * GET /api/v1/mobile/public/empty-legs  (GUEST — no token)
 *
 * Browse-as-guest before sign-up. Gated by the public-marketplace
 * flag (fail-closed). Every row goes through the SAME serializer
 * as the authed surface, so prices are stripped server-side when
 * pricing is off.
 *
 * Price-inference guard: when pricing is hidden, the `maxPrice`
 * filter is IGNORED — otherwise a guest could binary-search it to
 * infer the hidden SAR figure.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseIntParam(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!flagOn('ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE')) {
    return withCors(req, mobileError('flag_disabled'));
  }

  const url = new URL(req.url);
  const departure = (url.searchParams.get('departure') ?? '').slice(0, 64);
  const minPassengersRaw = url.searchParams.get('min_passengers');
  const limit = Math.max(1, Math.min(parseIntParam(url.searchParams.get('limit'), 50), 50));
  const pricingVisible = clientPricingVisible();

  let legs: Awaited<ReturnType<typeof listPublicAvailableLegs>>;
  try {
    legs = await listPublicAvailableLegs({
      departure: departure.length > 0 ? departure : null,
      minPassengers: minPassengersRaw ? parseIntParam(minPassengersRaw, 0) : null,
      // Drop the price filter entirely when prices are hidden
      // (prevents SAR inference via the filter).
      maxPrice: pricingVisible
        ? (() => {
            const mp = url.searchParams.get('max_price');
            return mp ? parseIntParam(mp, 0) : null;
          })()
        : null,
      limit,
    });
  } catch (err) {
    console.error('[mobile.public.empty-legs.list] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({
      pricing_visible: pricingVisible,
      legs: legs.map((row) => serializeEmptyLegForMobile(row, { viewerClientId: null })),
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
