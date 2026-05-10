import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getRawSessionTokenFromCookie,
  hashSessionToken,
  clearOperatorSessionCookie,
} from '@/lib/operators/auth';

/**
 * Phase 8 PR 2c — POST /operator/logout
 *
 * Server endpoint used by `<form action="/operator/logout"
 * method="post">` and the OperatorLogoutButton client
 * component. Revokes the session row + clears the cookie +
 * redirects to /operator/login.
 *
 * Idempotent: missing cookie / already-revoked session → still
 * clears + redirects.
 */
export async function POST() {
  const raw = getRawSessionTokenFromCookie();
  if (raw) {
    const tokenHash = hashSessionToken(raw);
    try {
      const client = createAdminClient();
      await client.rpc('operator_logout', { p_session_token_hash: tokenHash });
    } catch (err) {
      console.error('[operator/logout] rpc error', err);
    }
  }
  clearOperatorSessionCookie();
  return NextResponse.redirect(new URL('/operator/login', process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa'));
}
