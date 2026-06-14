import { NextResponse } from 'next/server';

import { runClientDeclineOffer } from '@/lib/clients/core/trip-requests-core';
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

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface DeclineBody {
  source?: unknown;
}

export async function POST(
  req: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<DeclineBody>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const { id } = await params;
  const result = await runClientDeclineOffer(auth.session.client_id, {
    offer_id: id,
    source: typeof body.value.source === 'string' ? body.value.source : '',
  } as Parameters<typeof runClientDeclineOffer>[1]);

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
