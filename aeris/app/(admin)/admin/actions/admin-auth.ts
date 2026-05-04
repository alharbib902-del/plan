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
import { adminLoginSchema } from '@/lib/validators/admin';

export type SignInResult =
  | { ok: true }
  | { ok: false; error: 'env' | 'invalid_password' | 'invalid_input' };

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

  const parsed = adminLoginSchema.safeParse({
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  // verifyPassword reads env again internally; safe because requireAdminEnv passed.
  void env;
  if (!verifyPassword(parsed.data.password)) {
    return { ok: false, error: 'invalid_password' };
  }

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
