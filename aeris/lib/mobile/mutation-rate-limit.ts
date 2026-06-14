import 'server-only';

import type { NextResponse } from 'next/server';

import {
  checkPublicActionRateLimitForIdentity,
  recordPublicActionAttempt,
} from '@/lib/rate-limit/public-action';
import type { PublicActionAttemptOutcome } from '@/lib/rate-limit/public-action-core';
import { mobileError, withCors } from '@/lib/mobile/http';

const ACTION = 'client_authed_mutation';

export type MobileMutationRateLimitResult =
  | { ok: true; actorFingerprint: string }
  | { ok: false; response: NextResponse };

export async function checkMobileMutationRateLimit(
  req: Request,
  tokenHash: string
): Promise<MobileMutationRateLimitResult> {
  const verdict = await checkPublicActionRateLimitForIdentity(
    ACTION,
    `token_hash:${tokenHash}`
  );

  if (verdict.ok) {
    return { ok: true, actorFingerprint: verdict.actorFingerprint };
  }

  await recordPublicActionAttempt(
    ACTION,
    verdict.actorFingerprint,
    verdict.reason === 'secret_missing' || verdict.reason === 'storage_error'
      ? 'rpc_error'
      : 'rate_limited'
  );

  return {
    ok: false,
    response: withCors(
      req,
      mobileError(
        verdict.reason === 'secret_missing' || verdict.reason === 'storage_error'
          ? verdict.reason
          : 'rate_limited',
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
  await recordPublicActionAttempt(ACTION, actorFingerprint, outcome);
}

export function mutationOutcomeForError(
  code: string
): PublicActionAttemptOutcome {
  if (code === 'validation_failed' || code === 'malformed_body') {
    return 'validation_failed';
  }
  if (
    code === 'rpc_failed' ||
    code === 'rpc_error' ||
    code === 'storage_error' ||
    code === 'secret_missing' ||
    // server/dependency/crypto faults — not client-input errors, so they
    // attribute to rpc_error in the rate-limit ledger (label only; any
    // non-success already counts toward the cap).
    code === 'lookup_failed' ||
    code === 'update_failed' ||
    code === 'bcrypt_failed'
  ) {
    return 'rpc_error';
  }
  return 'validation_failed';
}
