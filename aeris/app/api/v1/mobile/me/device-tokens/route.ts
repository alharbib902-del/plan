import { NextResponse } from 'next/server';

import { flagOn } from '@/lib/config/feature-flags';
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
import {
  registerDeviceToken,
  unregisterDeviceToken,
} from '@/lib/push/device-tokens';
import {
  deviceTokenRegisterSchema,
  deviceTokenUnregisterSchema,
} from '@/lib/validators/clients';

/**
 * POST   /api/v1/mobile/me/device-tokens  → register this device's push token
 * DELETE /api/v1/mobile/me/device-tokens  → unregister it (on logout)
 *
 * Push PR1: registration ONLY (no sending). Both are per-token rate-limited
 * mutations behind ENABLE_PUSH_NOTIFICATIONS (fail-closed → flag_disabled when
 * off). The token is tied to the validated Bearer session's client_id; the RPC
 * re-points a token across accounts (one device → current client). DELETE
 * carries the token in the JSON body (NOT a query string) so the sensitive
 * device identifier never lands in URLs/logs/proxies.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);
  if (!flagOn('ENABLE_PUSH_NOTIFICATIONS')) {
    return withCors(req, mobileError('flag_disabled'));
  }

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<unknown>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const parsed = deviceTokenRegisterSchema.safeParse(body.value);
  if (!parsed.success) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError('validation_failed'));
  }

  const result = await registerDeviceToken(
    auth.session.client_id,
    parsed.data.token,
    parsed.data.platform
  );
  await recordMobileMutationAttempt(
    rl.actorFingerprint,
    result.ok ? 'success' : mutationOutcomeForError(result.error)
  );
  if (!result.ok) return withCors(req, mobileError(result.error));
  return withCors(req, mobileOk());
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);
  if (!flagOn('ENABLE_PUSH_NOTIFICATIONS')) {
    return withCors(req, mobileError('flag_disabled'));
  }

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<unknown>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const parsed = deviceTokenUnregisterSchema.safeParse(body.value);
  if (!parsed.success) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError('validation_failed'));
  }

  const result = await unregisterDeviceToken(
    auth.session.client_id,
    parsed.data.token
  );
  await recordMobileMutationAttempt(
    rl.actorFingerprint,
    result.ok ? 'success' : mutationOutcomeForError(result.error)
  );
  if (!result.ok) return withCors(req, mobileError(result.error));
  return withCors(req, mobileOk());
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
