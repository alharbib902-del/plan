import { NextResponse } from 'next/server';

import {
  runGetClientProfile,
  runUpdateClientProfile,
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
 * GET   /api/v1/mobile/me/profile  → the client's own profile
 * PATCH /api/v1/mobile/me/profile  → update full_name/phone/marketing_opt_in
 *
 * Both share the transport-neutral profile core with the web
 * (clients-public.ts clientUpdateProfile delegates to the same
 * runUpdateClientProfile). auth_email is read-only (not accepted on
 * PATCH). PATCH is a mutation → per-token rate-limit; both are
 * blocked when password_must_change=true (requireClientBearer
 * default, no allowPasswordChange).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  let profile: Awaited<ReturnType<typeof runGetClientProfile>>;
  try {
    profile = await runGetClientProfile(auth.session.client_id);
  } catch (err) {
    console.error('[mobile.me.profile.get] read failed', err);
    return withCors(req, mobileError('rpc_failed'));
  }
  if (!profile) return withCors(req, mobileError('client_not_found'));

  return withCors(req, mobileOk({ profile }));
}

interface ProfilePatchBody {
  full_name?: unknown;
  phone?: unknown;
  marketing_opt_in?: unknown;
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req);
  if (!auth.ok) return withCors(req, auth.response);

  const rl = await checkMobileMutationRateLimit(req, auth.token_hash);
  if (!rl.ok) return rl.response;

  const body = await readJsonBody<ProfilePatchBody>(req);
  if (!body.ok) {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError(body.error));
  }

  // FULL-REPLACEMENT semantics (NOT a partial patch): the client must send
  // ALL editable fields. marketing_opt_in is required EXPLICITLY here so a
  // missing flag is rejected rather than silently written as `false`
  // (full_name/phone are already required by clientUpdateProfileSchema).
  if (typeof body.value.marketing_opt_in !== 'boolean') {
    await recordMobileMutationAttempt(rl.actorFingerprint, 'validation_failed');
    return withCors(req, mobileError('validation_failed'));
  }

  const result = await runUpdateClientProfile(auth.session.client_id, {
    full_name: typeof body.value.full_name === 'string' ? body.value.full_name : '',
    phone: typeof body.value.phone === 'string' ? body.value.phone : '',
    marketing_opt_in: body.value.marketing_opt_in,
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

  return withCors(req, mobileOk());
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
