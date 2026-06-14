import { NextResponse } from 'next/server';

import { listBookingsForClient } from '@/lib/clients/queries/me-bookings';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializeBookingForMobile } from '@/lib/mobile/serializers/bookings';

/**
 * GET /api/v1/mobile/bookings  (AUTHED)
 *
 * The client's own bookings (newest first). Reuses
 * listBookingsForClient which excludes client_id=null rows and is
 * pinned to the session client_id. Gated by ENABLE_CLIENT_PORTAL
 * via requireClientBearer.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  let rows: Awaited<ReturnType<typeof listBookingsForClient>>;
  try {
    rows = await listBookingsForClient(auth.session.client_id);
  } catch (err) {
    console.error('[mobile.bookings.list] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({ bookings: rows.map(serializeBookingForMobile) })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
