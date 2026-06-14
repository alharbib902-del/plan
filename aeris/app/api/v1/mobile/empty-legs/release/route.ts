import { NextResponse } from 'next/server';

import { runReleaseEmptyLeg } from '@/lib/empty-legs/core/empty-legs-core';
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

/**
 * POST /api/v1/mobile/empty-legs/release  (AUTHED)
 * Body: { leg_id }
 *
 * Releases the caller's own reservation. The ENABLE_CLIENT_EMPTY_LEGS_PORTAL
 * flag is enforced inside the core (single source of truth — runs before any
 * RPC), so unlike the GET routes it is NOT re-checked here. Ownership + state
 * guards are enforced in the §4.6 RPC via p_client_id (from the session); the
 * opaque `cancel_not_allowed` covers not-owned/wrong-state.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface ReleaseBody {
  leg_id?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<ReleaseBody>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const result = await runReleaseEmptyLeg(auth.session.client_id, {
    leg_id: typeof body.value.leg_id === 'string' ? body.value.leg_id : '',
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

  return withCors(
    req,
    mobileOk({ leg_id: result.leg_id, released_at: result.released_at })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
