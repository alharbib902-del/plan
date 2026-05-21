import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  createAdminUserSession,
  revokeAdminUserSession,
  touchAdminUserSession,
  validateAdminUserSessionToken,
} from '@/lib/admin/users/sessions';
import type { AdminUserRole } from '@/lib/admin/users/queries';

/**
 * Admin auth module — Option B Phase 1b (login cutover).
 *
 * Prior to this PR, /admin/login authenticated against a shared
 * ADMIN_INBOX_PASSWORD and issued a stateless signed cookie.
 * That coupled every admin to the same secret and gave audit
 * logs no actor attribution.
 *
 * Now:
 *   - Login is email + password against admin_users (Phase 1a).
 *   - Cookie carries a raw 256-bit session token (NOT signed —
 *     the DB lookup by sha256(token) is the authoritative check).
 *   - requireAdminSession() validates the token + ensures the
 *     owning admin_users row is still status='active' (Phase 1a
 *     P1 fix in sessions.ts).
 *   - Sign-out REVOKES the session in DB, not just clears the
 *     cookie — a stolen cookie is invalidated server-side too.
 *
 * Env contract:
 *   - ADMIN_AUTH_SECRET     — required. Reused as the HMAC seed
 *                              for rate-limit fingerprints +
 *                              (later) MFA enrollment QR signing.
 *   - ADMIN_INBOX_PASSWORD  — optional after founder seed. Only
 *                              read by the auto-seed branch in
 *                              signInWithEmail when admin_users
 *                              is empty.
 *   - ADMIN_FOUNDER_EMAIL   — required by the auto-seed branch.
 *                              Fail-closed if unset AND no
 *                              admin row exists yet.
 *
 * Old V1 cookies (period/version/expiry/nonce/sig) will fail the
 * new validation and the caller gets redirected to /admin/login.
 * One-time inconvenience at cutover time.
 */

type AdminCookieOptions = {
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  secure: boolean;
};

export const ADMIN_COOKIE_NAME = 'aeris_admin';
export const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export class AdminEnvError extends Error {
  constructor(detail: string) {
    super(`Admin env misconfigured: ${detail}`);
    this.name = 'AdminEnvError';
  }
}

export interface AdminEnv {
  /** The shared rate-limit/MFA HMAC secret. Always required. */
  secret: string;
}

export function requireAdminEnv(): AdminEnv {
  const secret = process.env.ADMIN_AUTH_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new AdminEnvError('ADMIN_AUTH_SECRET is missing or empty');
  }
  if (secret.trim().length < 16) {
    throw new AdminEnvError('ADMIN_AUTH_SECRET must be at least 16 chars');
  }
  return { secret };
}

// --------------------------------------------------------------
// Cookie helpers — raw-token format
// --------------------------------------------------------------

export function getAdminCookieOptions(
  maxAgeSeconds: number = SEVEN_DAYS_SECONDS
): AdminCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    maxAge: maxAgeSeconds,
    secure: process.env.NODE_ENV === 'production',
  };
}

/** Set the admin cookie with the freshly minted raw token. */
export function setAdminCookie(rawToken: string): void {
  cookies().set(
    ADMIN_COOKIE_NAME,
    rawToken,
    getAdminCookieOptions(SEVEN_DAYS_SECONDS)
  );
}

/** Clear the cookie + revoke the underlying session row. */
export async function clearAdminCookieAndSession(): Promise<void> {
  const cookieJar = cookies();
  const raw = cookieJar.get(ADMIN_COOKIE_NAME)?.value;
  cookieJar.delete({ name: ADMIN_COOKIE_NAME, path: '/admin' });

  if (raw && raw.length > 0) {
    const verdict = await validateAdminUserSessionToken(raw);
    if (verdict.ok) {
      // Self-revoke: we don't know the actor id at this point
      // (we're about to clear it), so revoked_by stays NULL.
      await revokeAdminUserSession(verdict.session.id, null);
    }
  }
}

// --------------------------------------------------------------
// Session resolution
// --------------------------------------------------------------

export interface AdminSessionInfo {
  sessionId: string;
  adminUserId: string;
  role: AdminUserRole;
  email: string;
  mustChangePassword: boolean;
  /** Unix seconds. Kept for back-compat with admin-pii audit
   *  loggers that used to read VerifiedCookie.expiry. */
  expiry: number;
}

/**
 * Validate the cookie + return the resolved session. On failure
 * the cookie is cleared (so a stale/revoked cookie doesn't keep
 * triggering DB lookups on every request) and the caller is
 * redirected to /admin/login.
 *
 * `touchSession=true` (default) updates last_seen_at — small
 * extra write per request but worth it for session hygiene.
 * Pass false from very-hot read endpoints if needed.
 */
export async function requireAdminSession(opts: {
  touchSession?: boolean;
} = {}): Promise<AdminSessionInfo> {
  requireAdminEnv();

  const cookieJar = cookies();
  const raw = cookieJar.get(ADMIN_COOKIE_NAME)?.value;
  if (!raw || raw.length === 0) {
    redirect('/admin/login');
  }

  const verdict = await validateAdminUserSessionToken(raw);
  if (!verdict.ok) {
    // Clear the bad cookie before redirect so the user doesn't
    // get stuck in a loop. We can't await revoke here — the
    // session row already doesn't satisfy the validate predicate.
    cookieJar.delete({ name: ADMIN_COOKIE_NAME, path: '/admin' });
    redirect('/admin/login');
  }

  // Pull the user row so the caller has role + must_change_password
  // without a second hop. validateAdminUserSessionToken already
  // joined to admin_users to gate on status='active', so this
  // second read is at most a small index hit.
  const userInfo = await loadAdminUserSummary(verdict.session.admin_user_id);
  if (!userInfo) {
    // FK CASCADE should make this unreachable, but fail-closed.
    cookieJar.delete({ name: ADMIN_COOKIE_NAME, path: '/admin' });
    redirect('/admin/login');
  }

  if (opts.touchSession !== false) {
    // Fire-and-forget timestamp update; we don't block the
    // request on it.
    void touchAdminUserSession(verdict.session.id);
  }

  return {
    sessionId: verdict.session.id,
    adminUserId: verdict.session.admin_user_id,
    role: userInfo.role,
    email: userInfo.email,
    mustChangePassword: userInfo.must_change_password,
    expiry: Math.floor(
      new Date(verdict.session.expires_at).getTime() / 1000
    ),
  };
}

/**
 * Non-redirecting variant used by the /admin/login page to
 * decide whether to bounce an already-authenticated user
 * straight to the dashboard.
 */
export async function hasAdminSession(): Promise<boolean> {
  try {
    requireAdminEnv();
  } catch {
    return false;
  }
  const raw = cookies().get(ADMIN_COOKIE_NAME)?.value;
  if (!raw || raw.length === 0) return false;
  const verdict = await validateAdminUserSessionToken(raw);
  return verdict.ok;
}

/**
 * Mint a new session for the freshly authenticated admin +
 * persist the cookie. Returns the resolved session info so the
 * caller (signIn Server Action) can decide whether to redirect
 * to /admin/account/password (must_change_password=true) or
 * the default dashboard.
 */
export async function issueAdminSession(input: {
  adminUserId: string;
  userAgent: string | null;
  ipFingerprint: string | null;
}): Promise<{ raw_token: string; sessionId: string } | null> {
  const created = await createAdminUserSession({
    admin_user_id: input.adminUserId,
    user_agent_snapshot: input.userAgent,
    ip_fingerprint: input.ipFingerprint,
  });
  if (!created) return null;
  setAdminCookie(created.raw_token);
  return { raw_token: created.raw_token, sessionId: created.session.id };
}

// --------------------------------------------------------------
// Internal: small admin-user summary read (used by requireAdminSession)
// --------------------------------------------------------------

interface AdminUserSummary {
  email: string;
  role: AdminUserRole;
  must_change_password: boolean;
}

type LooseSummaryStore = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
  };
};

async function loadAdminUserSummary(
  adminUserId: string
): Promise<AdminUserSummary | null> {
  // Local import to avoid a top-level cycle with createAdminClient
  // (which itself transitively re-imports auth.ts in some test
  // setups; the function-local require pattern keeps this safe).
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const store = createAdminClient() as unknown as LooseSummaryStore;
  const { data, error } = await store
    .from('admin_users')
    .select('email, role, must_change_password')
    .eq('id', adminUserId)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[admin-auth.loadSummary] read failed', error);
    }
    return null;
  }
  return (data as AdminUserSummary | null) ?? null;
}
