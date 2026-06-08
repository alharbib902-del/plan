import 'server-only';

import { createHash, timingSafeEqual } from 'crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  hashAdminPassword,
  normalizeAdminEmail,
} from '@/lib/admin/users/credentials';
import { insertAdminUser } from '@/lib/admin/users/queries';

/**
 * Founder auto-seed for the Phase 1b cutover.
 *
 * Premise: when /admin/login is first deployed with the new
 * email+password form, the admin_users table is empty. The
 * very first login attempt by the founder bootstraps their
 * own row using the still-present ADMIN_INBOX_PASSWORD env
 * (the old shared password). Subsequent logins use the
 * bcrypt-hashed copy stored on that row, and the env can be
 * unset.
 *
 * Hardening:
 *   - Auto-seed runs ONLY when the table is completely empty.
 *     If even one admin row exists, the founder must be
 *     created via owner-driven admin UI (PR-2b).
 *   - Email MUST match ADMIN_FOUNDER_EMAIL env exactly
 *     (normalized lowercase).
 *   - Password MUST match the existing ADMIN_INBOX_PASSWORD
 *     via constant-time sha256 compare.
 *   - The seeded row gets `must_change_password=true` so the
 *     founder is forced to rotate to a brand-new password the
 *     first time they hit /admin/account/password (PR-2b UI).
 *   - Role defaults to 'owner'; full_name defaults to env or
 *     'Founder'.
 *
 * Returns `{ ok: true; adminUserId }` on a successful seed,
 * `{ ok: false; reason }` on every other path (including the
 * common "table not empty, fall through to normal login").
 */

export type FounderSeedResult =
  | { ok: true; admin_user_id: string }
  | {
      ok: false;
      reason:
        | 'table_not_empty'
        | 'env_missing'
        | 'email_mismatch'
        | 'password_mismatch'
        | 'storage_error'
        | 'insert_failed';
    };

type LooseCountStore = {
  from: (table: string) => {
    select: (
      cols: string,
      opts: { count: 'exact'; head: boolean }
    ) => Promise<{
      count: number | null;
      error: { message?: string } | null;
    }>;
  };
};

async function adminUsersIsEmpty(): Promise<boolean | null> {
  const store = createAdminClient() as unknown as LooseCountStore;
  const { count, error } = await store
    .from('admin_users')
    .select('id', { count: 'exact', head: true });
  if (error) {
    console.error('[founder-seed] count failed', error);
    return null;
  }
  return (count ?? 0) === 0;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a, 'utf8').digest();
  const bh = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ah, bh);
}

export async function tryFounderSeed(input: {
  email: string;
  password: string;
}): Promise<FounderSeedResult> {
  const empty = await adminUsersIsEmpty();
  if (empty === null) return { ok: false, reason: 'storage_error' };
  if (!empty) return { ok: false, reason: 'table_not_empty' };

  const founderEmailEnv = process.env.ADMIN_FOUNDER_EMAIL;
  const sharedPasswordEnv = process.env.ADMIN_INBOX_PASSWORD;
  const founderNameEnv = process.env.ADMIN_FOUNDER_NAME ?? 'Founder';

  if (
    !founderEmailEnv ||
    founderEmailEnv.trim().length === 0 ||
    !sharedPasswordEnv ||
    sharedPasswordEnv.trim().length === 0
  ) {
    console.error(
      '[founder-seed] ADMIN_FOUNDER_EMAIL or ADMIN_INBOX_PASSWORD missing; auto-seed disabled'
    );
    return { ok: false, reason: 'env_missing' };
  }

  if (
    normalizeAdminEmail(input.email) !== normalizeAdminEmail(founderEmailEnv)
  ) {
    return { ok: false, reason: 'email_mismatch' };
  }

  if (!constantTimeStringEqual(input.password, sharedPasswordEnv)) {
    return { ok: false, reason: 'password_mismatch' };
  }

  // All three guards passed → hash the password + insert the
  // founder row. NOT calling validateAdminPassword here on
  // purpose: the existing shared password may not meet the new
  // strength rules (it predates them), and forcing the founder
  // to pick a new strong password is the JOB of the
  // must_change_password gate on the next login.
  const hash = await hashAdminPassword(input.password);
  const inserted = await insertAdminUser({
    email: normalizeAdminEmail(founderEmailEnv),
    password_hash: hash,
    full_name: founderNameEnv.trim() || 'Founder',
    role: 'owner',
    must_change_password: true,
    created_by_admin_user_id: null,
  });

  if (!inserted.ok) {
    console.error('[founder-seed] insertAdminUser failed', inserted.reason);
    return { ok: false, reason: 'insert_failed' };
  }

  return { ok: true, admin_user_id: inserted.user.id };
}
