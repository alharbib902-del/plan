import { NextResponse } from 'next/server';

import {
  runDeleteClientAlert,
  runSetClientAlertActive,
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

/**
 * PATCH  /api/v1/mobile/empty-legs/alerts/[id]  body { active } → toggle
 * DELETE /api/v1/mobile/empty-legs/alerts/[id]                 → delete
 *
 * Ownership enforced in the RPCs via p_client_id (from session),
 * never the path/body. The alert id comes from the path.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  active?: unknown;
}

export async function PATCH(
  req: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<PatchBody>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }
  if (typeof body.value.active !== 'boolean') {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError('validation_failed'));
  }

  const { id } = await params;
  const result = await runSetClientAlertActive(auth.session.client_id, {
    alert_id: id,
    active: body.value.active,
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
  return withCors(req, mobileOk({ id, is_active: body.value.active }));
}

export async function DELETE(
  req: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const { id } = await params;
  const result = await runDeleteClientAlert(auth.session.client_id, {
    alert_id: id,
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
  return withCors(req, mobileOk({ id }));
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
