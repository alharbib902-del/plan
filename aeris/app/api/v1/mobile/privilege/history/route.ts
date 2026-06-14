import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
import { readClientLedgerHistoryById } from '@/lib/privilege/client-pii';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  withCors,
} from '@/lib/mobile/http';
import { serializePrivilegeLedgerRow } from '@/lib/mobile/serializers/privilege';

/**
 * GET /api/v1/mobile/privilege/history  (AUTHED, behind ENABLE_PRIVILEGE)
 *
 * Full cashback/loyalty ledger (last 100). Same serializer as the
 * dashboard's recent_ledger — admin audit fields + raw client_id stripped.
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

  let result: Awaited<ReturnType<typeof readClientLedgerHistoryById>>;
  try {
    result = await readClientLedgerHistoryById(auth.session.client_id, {
      limit: 100,
    });
  } catch (err) {
    console.error('[mobile.privilege.history] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({ ledger: result.ledger.map(serializePrivilegeLedgerRow) })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
