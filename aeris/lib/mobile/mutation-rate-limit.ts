import 'server-only';

import type { NextResponse } from 'next/server';

import {
  checkPublicActionRateLimitForIdentity,
  recordPublicActionAttempt,
} from '@/lib/rate-limit/public-action';
import type { PublicActionAttemptOutcome } from '@/lib/rate-limit/public-action-core';
import { mobileError, withCors } from '@/lib/mobile/http';
import {
  MOBILE_MUTATION_ACTION,
  mobileMutationActorIdentity,
  mobileRateLimitDenialCode,
  mobileRateLimitDenialOutcome,
  mutationOutcomeForError,
} from '@/lib/mobile/mutation-rate-limit-core';

// Re-exported so the route handlers keep importing it from this
// server module (the pure mapping lives in the -core sibling, which
// the unit suite imports directly — it can't load this server-only
// module under tsx).
export { mutationOutcomeForError };

export type MobileMutationRateLimitResult =
  | { ok: true; actorFingerprint: string }
  | { ok: false; response: NextResponse };

export async function checkMobileMutationRateLimit(
  req: Request,
  tokenHash: string
): Promise<MobileMutationRateLimitResult> {
  const verdict = await checkPublicActionRateLimitForIdentity(
    MOBILE_MUTATION_ACTION,
    mobileMutationActorIdentity(tokenHash)
  );

  if (verdict.ok) {
    return { ok: true, actorFingerprint: verdict.actorFingerprint };
  }

  await recordPublicActionAttempt(
    MOBILE_MUTATION_ACTION,
    verdict.actorFingerprint,
    mobileRateLimitDenialOutcome(verdict.reason)
  );

  return {
    ok: false,
    response: withCors(
      req,
      mobileError(
        mobileRateLimitDenialCode(verdict.reason),
        { retry_after: verdict.retryAfterSeconds },
        {
          headers: { 'Retry-After': String(verdict.retryAfterSeconds) },
        }
      )
    ),
  };
}

export async function recordMobileMutationAttempt(
  actorFingerprint: string,
  outcome: PublicActionAttemptOutcome
): Promise<void> {
  await recordPublicActionAttempt(
    MOBILE_MUTATION_ACTION,
    actorFingerprint,
    outcome
  );
}
