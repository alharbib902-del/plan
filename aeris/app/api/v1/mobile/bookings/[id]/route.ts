import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import {
  getBookingForClient,
  getActiveCheckoutForBooking,
  bookingHasActivePaymentAttempt,
} from '@/lib/clients/queries/me-bookings';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeBookingForMobile } from '@/lib/mobile/serializers/bookings';

/**
 * GET /api/v1/mobile/bookings/[id]  (AUTHED)
 *
 * Booking detail, pinned to the session client_id (404 for
 * another client's booking — no enumeration). The in-app payment
 * attempt state is included ONLY behind ENABLE_PAYMENTS (off
 * today → omitted; payment is settled offline, payment_status =
 * pending_offline).
 */
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
  let booking: Awaited<ReturnType<typeof getBookingForClient>>;
  try {
    booking = await getBookingForClient(auth.session.client_id, id);
  } catch (err) {
    console.error('[mobile.bookings.detail] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }
  if (!booking) return withCors(req, mobileError('booking_not_found'));

  const body: Record<string, unknown> = {
    booking: serializeBookingForMobile(booking),
  };

  // In-app payment is behind ENABLE_PAYMENTS (off today). When on,
  // surface the active-attempt state so the app can offer a status
  // re-confirm; ownership was already asserted by getBookingForClient.
  if (flagOn('ENABLE_PAYMENTS')) {
    try {
      body.payment = {
        active_checkout_id: await getActiveCheckoutForBooking(booking.id),
        has_active_attempt: await bookingHasActivePaymentAttempt(booking.id),
      };
    } catch (err) {
      console.error('[mobile.bookings.detail] payment state read failed', err);
    }
  }

  return withCors(req, mobileOk(body));
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
