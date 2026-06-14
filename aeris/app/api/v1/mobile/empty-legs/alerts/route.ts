import { NextResponse } from 'next/server';

import {
  runCreateClientAlert,
  runListClientAlerts,
} from '@/lib/empty-legs/core/empty-legs-core';
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
import { serializeAlertForMobile } from '@/lib/mobile/serializers/empty-legs';

/**
 * GET  /api/v1/mobile/empty-legs/alerts  → the client's own price alerts
 * POST /api/v1/mobile/empty-legs/alerts  → create one (rate-limited)
 *
 * Alerts gate the base client portal only (requireClientBearer), matching
 * the web alert Server Actions (createAlertAction/deleteAlert/toggleAlert
 * gate requireClientSession only — NOT ENABLE_CLIENT_EMPTY_LEGS_PORTAL), so
 * they intentionally work pre-empty-legs-activation. Ownership is enforced
 * in the SECURITY DEFINER RPCs via p_client_id (from the session).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  let alerts: Awaited<ReturnType<typeof runListClientAlerts>>;
  try {
    alerts = await runListClientAlerts(auth.session.client_id);
  } catch (err) {
    console.error('[mobile.empty-legs.alerts.list] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(
    req,
    mobileOk({ alerts: alerts.map(serializeAlertForMobile) })
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const result = await runCreateClientAlert(auth.session.client_id, body.value);

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

  return withCors(req, mobileOk({}, 201));
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
