import { NextResponse } from 'next/server';

import { resolveClientRequestContext } from '@/lib/clients/core/request-context';
import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { runReserveEmptyLeg } from '@/lib/empty-legs/core/empty-legs-core';
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
 * POST /api/v1/mobile/empty-legs/reserve  (AUTHED)
 * Body: { leg_id }
 *
 * Holds an available leg for the signed-in client. leg_id is in
 * the BODY (not the path) to avoid a Next mixed-slug conflict
 * with the [leg_number] detail route. The flag
 * (ENABLE_CLIENT_EMPTY_LEGS_PORTAL) + ownership are enforced in
 * the shared core. `price_at_reservation` is omitted when pricing
 * is hidden (no SAR leak in request-to-book mode).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface ReserveBody {
  leg_id?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<ReserveBody>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const ctx = await resolveClientRequestContext();
  const result = await runReserveEmptyLeg(
    auth.session.client_id,
    { leg_id: typeof body.value.leg_id === 'string' ? body.value.leg_id : '' },
    ctx
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

  return withCors(
    req,
    mobileOk({
      leg_id: result.leg_id,
      reserved_at: result.reserved_at,
      expires_at: result.expires_at,
      // Strip the SAR figure server-side when pricing is hidden.
      ...(clientPricingVisible()
        ? { price_at_reservation_sar: result.price_at_reservation }
        : {}),
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
