'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ADMIN_COOKIE_NAME,
  AdminEnvError,
  createAdminCookieValue,
  getAdminCookieOptions,
  requireAdminEnv,
  requireAdminSession,
  verifyPassword,
} from '@/lib/admin/auth';
import {
  checkAdminLoginRateLimit,
  recordAdminLoginAttempt,
} from '@/lib/admin/login-rate-limit';
import { adminLoginSchema } from '@/lib/validators/admin';

export type SignInResult =
  | { ok: true }
  | {
      ok: false;
      error: 'env' | 'invalid_password' | 'invalid_input' | 'rate_limited';
    };

export async function signIn(formData: FormData): Promise<SignInResult> {
  let env;
  try {
    env = requireAdminEnv();
  } catch (err) {
    if (err instanceof AdminEnvError) {
      console.error('[admin-auth] sign-in blocked by env error', err.message);
      return { ok: false, error: 'env' };
    }
    throw err;
  }

  const rateLimit = await checkAdminLoginRateLimit();
  if (!rateLimit.ok) {
    await recordAdminLoginAttempt(rateLimit.actorFingerprint, 'rate_limited');
    return { ok: false, error: 'rate_limited' };
  }

  const parsed = adminLoginSchema.safeParse({
    password: formData.get('password'),
  });
  if (!parsed.success) {
    await recordAdminLoginAttempt(rateLimit.actorFingerprint, 'invalid_input');
    return { ok: false, error: 'invalid_input' };
  }

  // verifyPassword reads env again internally; safe because requireAdminEnv passed.
  void env;
  if (!verifyPassword(parsed.data.password)) {
    await recordAdminLoginAttempt(
      rateLimit.actorFingerprint,
      'invalid_password'
    );
    return { ok: false, error: 'invalid_password' };
  }

  await recordAdminLoginAttempt(rateLimit.actorFingerprint, 'success');
  const value = createAdminCookieValue();
  cookies().set(ADMIN_COOKIE_NAME, value, getAdminCookieOptions());
  redirect('/admin/leads');
}

export async function signOut(): Promise<void> {
  // Even sign-out should require a valid session — otherwise an unauthenticated
  // request can spam this endpoint.
  requireAdminSession();
  cookies().delete({
    name: ADMIN_COOKIE_NAME,
    path: '/admin',
  });
  redirect('/admin/login');
}
