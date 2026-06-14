// No 'server-only' import on purpose — these are the PURE bucket /
// identity / outcome decisions the mobile mutation rate-limit binding
// delegates to, so the tsx unit suite can pin them (action name,
// token-scoped identity, 429 vs 503 mapping) without the Supabase-
// backed attempt store. The server module (mutation-rate-limit.ts)
// wires these to checkPublicActionRateLimitForIdentity.

import type { PublicActionAttemptOutcome } from '@/lib/rate-limit/public-action-core';

/**
 * The per-action bucket every mobile Bearer mutation shares
 * (reserve / release / alerts create-toggle-delete / charter
 * create-cancel / offer accept-decline). Its limits live in
 * PUBLIC_ACTION_LIMITS.client_authed_mutation.
 */
export const MOBILE_MUTATION_ACTION = 'client_authed_mutation' as const;

/**
 * Identity the limiter buckets a mobile mutation on: the session
 * token hash, NOT the IP — so two legitimate clients behind one NAT
 * don't throttle each other. The `token_hash:` prefix keeps it in a
 * different namespace from the IP-scoped public actions.
 */
export function mobileMutationActorIdentity(tokenHash: string): string {
  return `token_hash:${tokenHash}`;
}

/**
 * Check-phase denial reason → wire error code. An infra fault
 * (missing secret / storage down) surfaces as itself (→ 503 so the
 * app retries); a genuine throttle surfaces as `rate_limited` (→ 429
 * with Retry-After).
 */
export function mobileRateLimitDenialCode(
  reason: string
): 'secret_missing' | 'storage_error' | 'rate_limited' {
  return reason === 'secret_missing' || reason === 'storage_error'
    ? reason
    : 'rate_limited';
}

/** Check-phase denial reason → the attempt outcome we record. */
export function mobileRateLimitDenialOutcome(
  reason: string
): PublicActionAttemptOutcome {
  return reason === 'secret_missing' || reason === 'storage_error'
    ? 'rpc_error'
    : 'rate_limited';
}

/**
 * A core/route failure code → the attempt outcome we record so the
 * limiter counts it correctly (validation noise vs dependency fault).
 */
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
    code === 'secret_missing'
  ) {
    return 'rpc_error';
  }
  return 'validation_failed';
}
