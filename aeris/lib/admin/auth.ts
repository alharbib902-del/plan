import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'crypto';

type AdminCookieOptions = {
  httpOnly: true;
  sameSite: 'lax';
  path: string;
  maxAge: number;
  secure: boolean;
};

export const ADMIN_COOKIE_NAME = 'aeris_admin';
const COOKIE_VERSION = 'v1';
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export class AdminEnvError extends Error {
  constructor(detail: string) {
    super(`Admin env misconfigured: ${detail}`);
    this.name = 'AdminEnvError';
  }
}

export interface AdminEnv {
  password: string;
  secret: string;
}

export function requireAdminEnv(): AdminEnv {
  const password = process.env.ADMIN_INBOX_PASSWORD;
  const secret = process.env.ADMIN_AUTH_SECRET;

  if (!password || password.trim().length === 0) {
    throw new AdminEnvError('ADMIN_INBOX_PASSWORD is missing or empty');
  }
  if (!secret || secret.trim().length === 0) {
    throw new AdminEnvError('ADMIN_AUTH_SECRET is missing or empty');
  }
  return { password, secret };
}

function sha256(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest();
}

export function verifyPassword(input: string): boolean {
  const env = requireAdminEnv();
  const a = sha256(input ?? '');
  const b = sha256(env.password);
  return timingSafeEqual(a, b);
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function createAdminCookieValue(
  maxAgeSeconds: number = SEVEN_DAYS_SECONDS
): string {
  const env = requireAdminEnv();
  const expiry = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const nonce = randomBytes(8).toString('hex');
  const payload = `${COOKIE_VERSION}.${expiry}.${nonce}`;
  const signature = signPayload(payload, env.secret);
  return `${payload}.${signature}`;
}

export interface VerifiedCookie {
  valid: boolean;
  expiry?: number;
}

export function verifyAdminCookieValue(value: string | undefined): VerifiedCookie {
  if (!value) return { valid: false };

  const env = requireAdminEnv();
  const parts = value.split('.');
  if (parts.length !== 4) return { valid: false };

  const [version, expiryStr, nonce, signature] = parts;
  if (version !== COOKIE_VERSION) return { valid: false };

  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return { valid: false };
  if (expiry <= Math.floor(Date.now() / 1000)) return { valid: false };

  const payload = `${version}.${expiryStr}.${nonce}`;
  const expectedSig = signPayload(payload, env.secret);
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length) return { valid: false };
  if (!timingSafeEqual(a, b)) return { valid: false };

  return { valid: true, expiry };
}

export function getAdminCookieOptions(): AdminCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    maxAge: SEVEN_DAYS_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  };
}

/**
 * Single source of truth used by the (protected) layout AND every admin
 * mutation Server Action. On failure, redirects to /admin/login (which
 * throws NEXT_REDIRECT and aborts the caller).
 */
export function requireAdminSession(): VerifiedCookie {
  // Ensure env is sane before reading the cookie. Bubbles up as a clear
  // error in the UI when env is misconfigured.
  requireAdminEnv();

  const cookie = cookies().get(ADMIN_COOKIE_NAME)?.value;
  const verified = verifyAdminCookieValue(cookie);
  if (!verified.valid) {
    redirect('/admin/login');
  }
  return verified;
}

export function hasAdminSession(): boolean {
  try {
    requireAdminEnv();
  } catch {
    return false;
  }
  const cookie = cookies().get(ADMIN_COOKIE_NAME)?.value;
  return verifyAdminCookieValue(cookie).valid;
}
