import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashAdminPassword,
  normalizeAdminEmail,
  verifyAdminPassword,
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

export type VerifyCredentialsResult =
  | { ok: true; user: AdminUserRow }
  | {
      ok: false;
      reason: 'not_found' | 'disabled' | 'bad_password';
    };

/**
 * Server-side credential check. Always runs the bcrypt compare
 * even when the user doesn't exist (against a dummy hash) so
 * the response time can't leak whether an email exists in the
 * table — primary defense against user enumeration.
 */
const DUMMY_BCRYPT_HASH =
  '$2a$12$nuq.j1jVtL/MfsKMqHkOLeAhwoXMa1OZW8E0v8/Q3rJzlrkRyVS9.'; // bcrypt('does-not-match', 12)

export async function verifyAdminCredentials(
  rawEmail: string,
  password: string
): Promise<VerifyCredentialsResult> {
  const candidate = await lookupAdminUserByEmail(rawEmail);

  if (!candidate) {
    // Run bcrypt against a dummy hash so timing matches the
    // real path. Discard the result.
    await verifyAdminPassword(password, DUMMY_BCRYPT_HASH);
    return { ok: false, reason: 'not_found' };
  }

  const ok = await verifyAdminPassword(password, candidate.password_hash);
  if (!ok) {
    if (candidate.status === 'disabled') {
      return { ok: false, reason: 'disabled' };
    }
    return { ok: false, reason: 'bad_password' };
  }

  if (candidate.status === 'disabled') {
    return { ok: false, reason: 'disabled' };
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
// 4. helper: hash + insert in one call (founder seed convenience)
// --------------------------------------------------------------

export async function createAdminUserWithPassword(
  input: Omit<InsertAdminUserInput, 'password_hash'> & { password: string }
): Promise<InsertAdminUserResult> {
  const hash = await hashAdminPassword(input.password);
  return insertAdminUser({
    email: input.email,
    password_hash: hash,
    full_name: input.full_name,
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
