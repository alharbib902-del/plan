import { NextResponse, type NextRequest } from 'next/server';

/**
 * Phase 8 PR 2c — pathname-passthrough middleware.
 *
 * Next.js App Router server components do NOT receive
 * pathname directly. The Phase 8 operator portal needs to
 * know the current path to enforce the must-change-password
 * lockdown server-side (Codex round 1 PR #42 P1 #1 fix):
 * a `password_must_change=true` operator must be redirected
 * to /operator/profile/password from EVERY route except the
 * password page itself + logout.
 *
 * This middleware injects `x-pathname` into the request
 * headers so the authed layout can read it via Next.js's
 * `headers()` API and apply the redirect.
 *
 * Scope: only /operator/* — the admin shell + public site
 * pages do not need pathname injection.
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/operator/:path*'],
};
