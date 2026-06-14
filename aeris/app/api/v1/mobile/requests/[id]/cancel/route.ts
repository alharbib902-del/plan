import { NextResponse } from 'next/server';

import { runCancelMyTripRequest } from '@/lib/clients/core/trip-requests-core';
import { requireClientBearer } from '@/lib/mobile/auth';
import { mobileError, mobileOk, mobilePreflight, withCors } from '@/lib/mobile/http';
import {
  checkMobileMutationRateLimit,
  mutationOutcomeForError,
  recordMobileMutationAttempt,
} from '@/lib/mobile/mutation-rate-limit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  req: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const { id } = await params;
  const result = await runCancelMyTripRequest(auth.session.client_id, {
    trip_request_id: id,
  });

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

  return withCors(req, mobileOk(result));
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
