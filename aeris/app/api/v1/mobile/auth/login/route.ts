import { NextResponse } from 'next/server';

import { runClientLogin } from '@/lib/clients/core/auth-core';
import { resolveClientRequestContext } from '@/lib/clients/core/request-context';
import {
  mobileError,
  mobileOk,
  mobilePreflight,
  readJsonBody,
  withCors,
} from '@/lib/mobile/http';

/** Tighter body cap for the public auth surface (email+password is tiny). */
const AUTH_BODY_MAX_BYTES = 4 * 1024;

/**
 * POST /api/v1/mobile/auth/login
 *
 * Bearer-issuing login. Delegates to the SAME `runClientLogin`
 * core the web Server Action uses, but returns the minted raw
 * token in the JSON body (`token`) instead of an httpOnly
 * cookie. The app stores it in secure storage + sends
 * `Authorization: Bearer <token>`.
 *
 * `remember_me` defaults to TRUE on mobile (30-day session) —
 * there is no silent refresh today, so a long-lived session
 * avoids forcing a full re-login on every app open (the secure
 * storage + optional biometric gate are the compensating
 * controls).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface LoginBody {
  email?: unknown;
  password?: unknown;
  remember_me?: unknown;
}

export async function POST(req: Request): Promise<NextResponse> {
  const body = await readJsonBody<LoginBody>(req, AUTH_BODY_MAX_BYTES);
  if (!body.ok) return withCors(req, mobileError(body.error));

  const input = {
    email: typeof body.value.email === 'string' ? body.value.email : '',
    password:
      typeof body.value.password === 'string' ? body.value.password : '',
    // Default to a long-lived mobile session unless the app
    // explicitly opts out.
    remember_me:
      typeof body.value.remember_me === 'boolean'
        ? body.value.remember_me
        : true,
  };

  const ctx = await resolveClientRequestContext();
  const result = await runClientLogin(input, ctx);

  if (!result.ok) {
    // Surface a Retry-After hint on throttle so the client backs
    // off instead of hammering (the rate-limit's own goal).
    if (result.error === 'rate_limited' && result.retry_after_seconds) {
      return withCors(
        req,
        mobileError(
          'rate_limited',
          { retry_after: result.retry_after_seconds },
          { headers: { 'Retry-After': String(result.retry_after_seconds) } }
        )
      );
    }
    return withCors(
      req,
      mobileError(
        result.error,
        result.field_errors ? { field_errors: result.field_errors } : undefined
      )
    );
  }

  return withCors(
    req,
    mobileOk({
      client_id: result.client_id,
      token: result.raw_token,
      expires_at: result.expires_at,
      password_must_change: result.password_must_change,
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
