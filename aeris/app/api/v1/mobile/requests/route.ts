import { NextResponse } from 'next/server';

import { runCreateAuthenticatedTripRequest } from '@/lib/clients/core/trip-requests-core';
import {
  CLIENT_TRIP_STATUS_FILTERS,
  isClientTripStatusFilter,
  listTripRequestsForClient,
} from '@/lib/clients/queries/me-requests';
import { requireClientBearer } from '@/lib/mobile/auth';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  readJsonBody,
  withCors,
} from '@/lib/mobile/http';
import {
  checkMobileMutationRateLimit,
  mutationOutcomeForError,
  recordMobileMutationAttempt,
} from '@/lib/mobile/mutation-rate-limit';
import { serializeTripRequestForMobile } from '@/lib/mobile/serializers/charter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const filter = isClientTripStatusFilter(status) ? status : 'all';

  let rows: Awaited<ReturnType<typeof listTripRequestsForClient>>;
  try {
    rows = await listTripRequestsForClient(auth.session.client_id, filter);
  } catch (err) {
    console.error('[mobile.requests.list] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({
      filters: CLIENT_TRIP_STATUS_FILTERS,
      requests: rows.map(serializeTripRequestForMobile),
    })
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<Parameters<
    typeof runCreateAuthenticatedTripRequest
  >[1]>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const result = await runCreateAuthenticatedTripRequest(
    auth.session.client_id,
    body.value
  );

  await recordMobileMutationAttempt(
    rl.actorFingerprint,
    result.ok ? 'success' : mutationOutcomeForError(result.error)
  );

  if (!result.ok) {
    return withCors(
      req,
      mobileError(
        result.error,
        result.field_errors ? { field_errors: result.field_errors } : undefined
      )
    );
  }

  return withCors(req, mobileOk(result, 201));
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
