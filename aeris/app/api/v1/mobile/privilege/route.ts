import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import { readClientPrivilegeDashboardById } from '@/lib/privilege/client-pii';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializePrivilegeDashboardForMobile } from '@/lib/mobile/serializers/privilege';

/**
 * GET /api/v1/mobile/privilege  (AUTHED, behind ENABLE_PRIVILEGE)
 *
 * The client's own privilege dashboard (tier + cashback balance + recent
 * ledger + recent tier changes). Reads via the transport-neutral
 * readClientPrivilegeDashboardById(session.client_id) — the client-pii
 * core no longer calls requireClientSession() internally (PR4 4d). The
 * serializer drops the admin audit fields (admin_actor_cookie_fingerprint,
 * admin_reason) and the raw client_id.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);
  if (!flagOn('ENABLE_PRIVILEGE')) {
    return withCors(req, mobileError('flag_disabled'));
  }

  let dashboard: Awaited<ReturnType<typeof readClientPrivilegeDashboardById>>;
  try {
    dashboard = await readClientPrivilegeDashboardById(auth.session.client_id);
  } catch (err) {
    console.error('[mobile.privilege.dashboard] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({ dashboard: serializePrivilegeDashboardForMobile(dashboard) })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
