// Pure crypto primitives — no Next.js imports, no
// `server-only` import — so the unit-test runner under tsx
// can import this module directly. Mirrors the Phase 7
// pattern in `lib/empty-legs/matching.ts`.

import { createHash, randomBytes } from 'crypto';

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;
const SESSION_TOKEN_BYTES = 32;

export interface MintedClientSession {
  raw_token: string;
  token_hash: string;
  expires_at: Date;
  remember_me: boolean;
}

export function mintClientSessionToken(
  rememberMe: boolean
): MintedClientSession {
  const rawToken = randomBytes(SESSION_TOKEN_BYTES).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const ttl = rememberMe ? THIRTY_DAYS_SECONDS : SEVEN_DAYS_SECONDS;
  return {
    raw_token: rawToken,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + ttl * 1000),
    remember_me: rememberMe,
  };
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export const CLIENT_SESSION_TTL_SECONDS = {
  default: SEVEN_DAYS_SECONDS,
  remember_me: THIRTY_DAYS_SECONDS,
} as const;
