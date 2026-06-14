import { NextResponse } from 'next/server';

import { getTripRequestForClient } from '@/lib/clients/queries/me-requests';
import { requireClientBearer } from '@/lib/mobile/auth';
import { mobileError, mobileOk, mobilePreflight, withCors } from '@/lib/mobile/http';
import {
  serializeOfferForMobile,
  serializeTripRequestForMobile,
} from '@/lib/mobile/serializers/charter';
import { listOffersByTripUnified } from '@/lib/supabase/queries/unified-offers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  req: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const { id } = await params;
  let trip: Awaited<ReturnType<typeof getTripRequestForClient>>;
  try {
    trip = await getTripRequestForClient(auth.session.client_id, id);
  } catch (err) {
    console.error('[mobile.requests.detail] trip read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }
  if (!trip) return withCors(req, mobileError('request_not_found'));

  let offers: Awaited<ReturnType<typeof listOffersByTripUnified>>;
  try {
    offers =
      trip.status === 'pending' ? [] : await listOffersByTripUnified(trip.id);
  } catch (err) {
    console.error('[mobile.requests.detail] offers read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({
      request: serializeTripRequestForMobile(trip),
      offers: offers.map((offer) => serializeOfferForMobile(offer, trip.status)),
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
