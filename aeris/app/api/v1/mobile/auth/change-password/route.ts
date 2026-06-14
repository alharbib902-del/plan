import { NextResponse } from 'next/server';

import { runChangeClientPassword } from '@/lib/clients/core/profile-core';
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
 * POST /api/v1/mobile/auth/change-password  (AUTHED)
 * Body: { current_password, new_password }
 *
 * allowPasswordChange: true — this is the ONE escape hatch a client under
 * the password_must_change lockout can call to unlock themselves (it clears
 * the flag on success). Per-token rate-limit is MANDATORY here: it throttles
 * brute-forcing the CURRENT password (a wrong current_password is recorded
 * as auth_failed → counts toward the failure cap). Delegates to the shared
 * core (the web clientChangePassword uses the same runChangeClientPassword),
 * preserving the existing wire codes.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Tight body cap for the auth surface. */
const AUTH_BODY_MAX_BYTES = 4 * 1024;

interface ChangePasswordBody {
  current_password?: unknown;
  new_password?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req, { allowPasswordChange: true });
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<ChangePasswordBody>(req, AUTH_BODY_MAX_BYTES);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  const result = await runChangeClientPassword(auth.session.client_id, {
    current_password:
      typeof body.value.current_password === 'string'
        ? body.value.current_password
        : '',
    new_password:
      typeof body.value.new_password === 'string'
        ? body.value.new_password
        : '',
  });

  await recordMobileMutationAttempt(
    rl.actorFingerprint,
    result.ok
      ? 'success'
      : result.error === 'current_password_invalid'
        ? 'auth_failed'
        : mutationOutcomeForError(result.error)
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
