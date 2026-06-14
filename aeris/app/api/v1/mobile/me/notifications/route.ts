import { NextResponse } from 'next/server';

import {
  runGetNotificationPreferences,
  runUpdateNotificationPreferences,
} from '@/lib/clients/core/profile-core';
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
 * GET   /api/v1/mobile/me/notifications  → normalized preferences
 * PATCH /api/v1/mobile/me/notifications  → strict full replacement
 *
 * Shares the transport-neutral core with the web action
 * (clients-empty-legs.ts updateMyNotificationPreferences delegates to
 * runUpdateNotificationPreferences). GET applies the opt-in defaults;
 * PATCH validates strictly ({empty_legs:{email,wa_link}, marketing}) so
 * unknown keys are rejected. PATCH is a per-token-rate-limited mutation
 * and is blocked under password_must_change (requireClientBearer default).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  let preferences: Awaited<ReturnType<typeof runGetNotificationPreferences>>;
  try {
    preferences = await runGetNotificationPreferences(auth.session.client_id);
  } catch (err) {
    console.error('[mobile.me.notifications.get] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }

  return withCors(req, mobileOk({ preferences }));
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const result = await runUpdateNotificationPreferences(
    auth.session.client_id,
    body.value as Parameters<typeof runUpdateNotificationPreferences>[1]
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

  return withCors(req, mobileOk());
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
