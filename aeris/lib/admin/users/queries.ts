import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashAdminPassword,
  normalizeAdminEmail,
  validateAdminUserCreateInput,
  verifyAdminPassword,
  type CreateInputValidation,
} from '@/lib/admin/users/credentials';

/**
 * Server-only query layer for admin_users.
 *
 * No Server Actions are wired in this PR — these helpers exist
 * so the next PR (login cutover) has a tested surface to call.
 * Each function takes/returns plain shapes so they're trivially
 * unit-testable with a fake supabase client.
 */

export type AdminUserRole = 'owner' | 'admin' | 'support';
export type AdminUserStatus = 'active' | 'disabled';

export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: AdminUserRole;
  status: AdminUserStatus;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
}

interface RawAdminUserRow extends AdminUserRow {
  password_hash: string;
}

type LooseAdminUserStore = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle: () => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
      };
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>;
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

const TABLE = 'admin_users';

function store(): LooseAdminUserStore {
  return createAdminClient() as unknown as LooseAdminUserStore;
}

function stripHash(row: RawAdminUserRow): AdminUserRow {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    status: row.status,
    must_change_password: row.must_change_password,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    disabled_at: row.disabled_at,
  };
}

// --------------------------------------------------------------
// 1. lookup by email (used by login)
// --------------------------------------------------------------

const LOOKUP_COLS =
  'id, email, password_hash, full_name, role, status, must_change_password, created_at, last_login_at, disabled_at';

export async function lookupAdminUserByEmail(
  rawEmail: string
): Promise<RawAdminUserRow | null> {
  const email = normalizeAdminEmail(rawEmail);
  if (email.length === 0) return null;

  const { data, error } = await store()
    .from(TABLE)
    .select(LOOKUP_COLS)
    .eq('email', email)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[admin-users.lookupByEmail] read error', error);
    return null;
  }
  return (data as RawAdminUserRow | null) ?? null;
}

// --------------------------------------------------------------
// 2. credential verification (called from login Server Action)
// --------------------------------------------------------------

/**
 * Single failure reason exposed to callers — the granular
 * not_found / bad_password / disabled state stays in the
 * server logs only. PR #88 round-1 P2 fix: previously the
 * helper returned distinct reasons, which the login action
 * could (and would) plumb to the UI, letting an attacker
 * enumerate which emails exist + which are disabled.
 *
 * Strict contract: any failure → `invalid_credentials`.
 * The caller is REQUIRED to surface a single uniform message
 * to the user.
 */
export type VerifyCredentialsResult =
  | { ok: true; user: AdminUserRow }
  | { ok: false; reason: 'invalid_credentials' };

const DUMMY_BCRYPT_HASH =
  '$2a$12$nuq.j1jVtL/MfsKMqHkOLeAhwoXMa1OZW8E0v8/Q3rJzlrkRyVS9.'; // bcrypt('does-not-match', 12)

/** Internal granular reason — written to server logs only,
 *  never returned to callers. */
type InternalVerifyReason =
  | 'not_found'
  | 'bad_password'
  | 'disabled_with_bad_password'
  | 'disabled_with_good_password';

function logInternalVerifyFailure(
  reason: InternalVerifyReason,
  email: string
): void {
  console.warn('[admin-users.verifyCredentials] denied', { reason, email });
}

export async function verifyAdminCredentials(
  rawEmail: string,
  password: string
): Promise<VerifyCredentialsResult> {
  const candidate = await lookupAdminUserByEmail(rawEmail);

  if (!candidate) {
    // Run bcrypt against a dummy hash so timing matches the
    // real path. Discard the result.
    await verifyAdminPassword(password, DUMMY_BCRYPT_HASH);
    logInternalVerifyFailure('not_found', normalizeAdminEmail(rawEmail));
    return { ok: false, reason: 'invalid_credentials' };
  }

  const passwordOk = await verifyAdminPassword(
    password,
    candidate.password_hash
  );

  // Collapse all three failure modes to a single uniform reason
  // so the login Server Action can't accidentally surface
  // account-state differentiation to the UI.
  if (!passwordOk && candidate.status === 'disabled') {
    logInternalVerifyFailure('disabled_with_bad_password', candidate.email);
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (!passwordOk) {
    logInternalVerifyFailure('bad_password', candidate.email);
    return { ok: false, reason: 'invalid_credentials' };
  }
  if (candidate.status === 'disabled') {
    logInternalVerifyFailure('disabled_with_good_password', candidate.email);
    return { ok: false, reason: 'invalid_credentials' };
  }

  return { ok: true, user: stripHash(candidate) };
}

// --------------------------------------------------------------
// 3. insert (founder seed + owner-driven user creation)
// --------------------------------------------------------------

export interface InsertAdminUserInput {
  email: string;
  password_hash: string;
  full_name: string;
  role: AdminUserRole;
  must_change_password?: boolean;
  created_by_admin_user_id?: string | null;
}

export type InsertAdminUserResult =
  | { ok: true; user: AdminUserRow }
  | { ok: false; reason: 'duplicate_email' | 'storage_error' };

export async function insertAdminUser(
  input: InsertAdminUserInput
): Promise<InsertAdminUserResult> {
  const email = normalizeAdminEmail(input.email);
  const { data, error } = await store()
    .from(TABLE)
    .insert({
      email,
      password_hash: input.password_hash,
      full_name: input.full_name.trim(),
      role: input.role,
      must_change_password: input.must_change_password ?? false,
      created_by_admin_user_id: input.created_by_admin_user_id ?? null,
    })
    .select(LOOKUP_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, reason: 'duplicate_email' };
    }
    console.error('[admin-users.insert] failed', error);
    return { ok: false, reason: 'storage_error' };
  }
  return { ok: true, user: stripHash(data as RawAdminUserRow) };
}

// --------------------------------------------------------------
// 4. helper: validate + hash + insert in one call
//
// PR #88 round-1 P2 fix: previously the helper hashed any string
// the caller handed in, so a future code path could create an
// admin with a weak password. Now the email + password + name
// MUST pass validateAdminUserCreateInput before bcrypt runs;
// validation failures short-circuit before any DB or crypto work.
// --------------------------------------------------------------

export type CreateAdminUserWithPasswordResult =
  | InsertAdminUserResult
  | {
      ok: false;
      reason: 'invalid_input';
      validation_error: Extract<CreateInputValidation, { ok: false }>['error'];
    };

export async function createAdminUserWithPassword(
  input: Omit<InsertAdminUserInput, 'password_hash'> & { password: string }
): Promise<CreateAdminUserWithPasswordResult> {
  const v = validateAdminUserCreateInput({
    email: input.email,
    password: input.password,
    full_name: input.full_name,
  });
  if (!v.ok) {
    return { ok: false, reason: 'invalid_input', validation_error: v.error };
  }

  const hash = await hashAdminPassword(input.password);
  return insertAdminUser({
    email: v.email,
    password_hash: hash,
    full_name: v.full_name,
    role: input.role,
    must_change_password: input.must_change_password,
    created_by_admin_user_id: input.created_by_admin_user_id,
  });
}

// --------------------------------------------------------------
// 5. record successful login timestamp
// --------------------------------------------------------------

export async function stampAdminUserLogin(adminUserId: string): Promise<void> {
  const { error } = await store()
    .from(TABLE)
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', adminUserId);
  if (error) {
    console.error('[admin-users.stampLogin] failed', error);
  }
}

// --------------------------------------------------------------
// 6. password rotation
// --------------------------------------------------------------
//
// Updates password_hash + clears must_change_password atomically.
// Caller (the changePassword Server Action) is responsible for
// the current-password verification + new-password strength
// validation BEFORE calling this.
//
// Returns ok:false on storage error so the caller surfaces a
// retryable error to the user without leaking DB internals.
// --------------------------------------------------------------

export type RotateAdminUserPasswordResult =
  | { ok: true }
  | { ok: false; reason: 'storage_error' };

export async function rotateAdminUserPassword(input: {
  admin_user_id: string;
  new_password_hash: string;
}): Promise<RotateAdminUserPasswordResult> {
  const { error } = await store()
    .from(TABLE)
    .update({
      password_hash: input.new_password_hash,
      must_change_password: false,
    })
    .eq('id', input.admin_user_id);
  if (error) {
    console.error('[admin-users.rotatePassword] failed', error);
    return { ok: false, reason: 'storage_error' };
  }
  return { ok: true };
}

/**
 * Verify the current password (re-uses verifyAdminCredentials'
 * dummy-hash uniform-timing guard implicitly because the row
 * MUST exist — caller already has the session). Returns
 * `current_invalid` on mismatch without further differentiation.
 */
export type VerifyAdminCurrentPasswordResult =
  | { ok: true }
  | { ok: false; reason: 'current_invalid' | 'not_found' };

export async function verifyAdminCurrentPassword(input: {
  admin_user_id: string;
  current_password: string;
}): Promise<VerifyAdminCurrentPasswordResult> {
  const { data, error } = await store()
    .from(TABLE)
    .select(LOOKUP_COLS)
    .eq('id', input.admin_user_id)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[admin-users.verifyCurrent] read error', error);
    }
    return { ok: false, reason: 'not_found' };
  }
  const row = data as RawAdminUserRow | null;
  if (!row) return { ok: false, reason: 'not_found' };

  const ok = await verifyAdminPassword(input.current_password, row.password_hash);
  if (!ok) return { ok: false, reason: 'current_invalid' };
  return { ok: true };
}
