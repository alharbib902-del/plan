import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  mintSessionToken,
  sessionTokenHash,
} from '@/lib/admin/users/credentials';

/**
 * Server-only durable session ledger for admin_users.
 *
 * Cookie carries the RAW token (256-bit random, base64url).
 * Database stores ONLY sha256(token). Lookup compares hashes
 * — a DB read never leaks the cookie value, and a cookie value
 * never matches anything in a DB dump.
 *
 * Sessions have a hard expiry (7 days by default, same as the
 * legacy stateless cookie). A founder can revoke a single
 * admin's sessions without rotating the global secret.
 *
 * NOT WIRED into the login flow in this PR. The next PR (login
 * cutover) calls createAdminUserSession at signIn + replaces
 * lib/admin/auth.ts::requireAdminSession with a stateful check
 * that resolves a session row by token hash.
 */

const TABLE = 'admin_user_sessions';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type LooseSessionStore = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        is: (col: string, val: null) => {
          gt: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: unknown;
              error: { code?: string; message?: string } | null;
            }>;
          };
        };
        maybeSingle: () => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => Promise<{
        error: { message?: string } | null;
      }>;
    };
  };
};

function store(): LooseSessionStore {
  return createAdminClient() as unknown as LooseSessionStore;
}

export interface AdminUserSessionRow {
  id: string;
  admin_user_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface CreateAdminUserSessionInput {
  admin_user_id: string;
  user_agent_snapshot?: string | null;
  ip_fingerprint?: string | null;
  ttl_ms?: number;
}

export interface CreatedAdminUserSession {
  raw_token: string;
  session: AdminUserSessionRow;
}

export async function createAdminUserSession(
  input: CreateAdminUserSessionInput
): Promise<CreatedAdminUserSession | null> {
  const ttl = input.ttl_ms ?? DEFAULT_TTL_MS;
  const { token, hash } = mintSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl);

  const { data, error } = await store()
    .from(TABLE)
    .insert({
      admin_user_id: input.admin_user_id,
      token_hash: hash,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      last_seen_at: now.toISOString(),
      user_agent_snapshot: input.user_agent_snapshot ?? null,
      ip_fingerprint: input.ip_fingerprint ?? null,
    })
    .select('id, admin_user_id, created_at, expires_at, last_seen_at, revoked_at')
    .single();

  if (error) {
    console.error('[admin-user-sessions.create] failed', error);
    return null;
  }
  return {
    raw_token: token,
    session: data as AdminUserSessionRow,
  };
}

export type ValidateAdminUserSessionResult =
  | { ok: true; session: AdminUserSessionRow }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'revoked' | 'user_disabled';
    };

/**
 * Validates that:
 *   1. The token hash matches an existing session row.
 *   2. The session is not revoked and not expired.
 *   3. The OWNER admin_users row is still status='active'.
 *
 * PR #88 round-1 P1 fix: step 3 was missing. A disabled admin
 * whose sessions weren't explicitly revoked would keep their
 * cookie working until natural expiry. Now the second lookup
 * gates on status and returns `user_disabled` so the caller
 * can clear the cookie + redirect to /admin/login.
 *
 * Two reads instead of a PostgREST embed/join to keep the loose
 * type surface flat. Both reads hit unique/partial indexes; cost
 * is negligible compared to the bcrypt path on login.
 */
export async function validateAdminUserSessionToken(
  rawToken: string
): Promise<ValidateAdminUserSessionResult> {
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    return { ok: false, reason: 'not_found' };
  }
  const hash = sessionTokenHash(rawToken);
  const now = new Date().toISOString();

  const sessionStore = store();
  const { data, error } = await sessionStore
    .from(TABLE)
    .select('id, admin_user_id, created_at, expires_at, last_seen_at, revoked_at')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') return { ok: false, reason: 'not_found' };
    console.error('[admin-user-sessions.validate] session read failed', error);
    return { ok: false, reason: 'not_found' };
  }
  if (!data) {
    return { ok: false, reason: 'not_found' };
  }

  const row = data as AdminUserSessionRow;

  // PR #88 round-1 P1 — verify the owning admin is still active.
  const { data: userData, error: userError } = await sessionStore
    .from('admin_users')
    .select('status')
    .eq('id', row.admin_user_id)
    .maybeSingle();

  if (userError) {
    if (userError.code !== 'PGRST116') {
      console.error(
        '[admin-user-sessions.validate] user read failed',
        userError
      );
    }
    return { ok: false, reason: 'not_found' };
  }
  if (!userData) {
    // Session pointed at a now-deleted admin row. Treat the
    // session as invalid; FK ON DELETE CASCADE means we
    // shouldn't normally see this, but fail-closed.
    return { ok: false, reason: 'not_found' };
  }

  const userStatus = (userData as { status: string }).status;
  if (userStatus !== 'active') {
    return { ok: false, reason: 'user_disabled' };
  }

  return { ok: true, session: row };
}

export async function touchAdminUserSession(
  sessionId: string
): Promise<void> {
  const { error } = await store()
    .from(TABLE)
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) {
    console.error('[admin-user-sessions.touch] failed', error);
  }
}

export async function revokeAdminUserSession(
  sessionId: string,
  revokedByAdminUserId: string | null
): Promise<void> {
  const { error } = await store()
    .from(TABLE)
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_admin_user_id: revokedByAdminUserId,
    })
    .eq('id', sessionId);
  if (error) {
    console.error('[admin-user-sessions.revoke] failed', error);
  }
}

/**
 * Revoke every active session for an admin EXCEPT `keepSessionId`
 * (the caller's current session). Used after password rotation
 * so a leaked-then-rotated credential cannot keep impersonating
 * via lingering cookies on other devices.
 */
type LooseBulkRevokeStore = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => {
        neq: (col: string, val: unknown) => {
          is: (col: string, val: null) => Promise<{
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
};

export async function revokeOtherActiveAdminUserSessions(input: {
  admin_user_id: string;
  keep_session_id: string;
  revoked_by_admin_user_id: string;
}): Promise<void> {
  const bulkStore = store() as unknown as LooseBulkRevokeStore;
  const { error } = await bulkStore
    .from(TABLE)
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by_admin_user_id: input.revoked_by_admin_user_id,
    })
    .eq('admin_user_id', input.admin_user_id)
    .neq('id', input.keep_session_id)
    .is('revoked_at', null);
  if (error) {
    console.error(
      '[admin-user-sessions.revokeOtherActive] failed',
      error
    );
  }
}
