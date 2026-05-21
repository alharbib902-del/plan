import { NextResponse, type NextRequest } from 'next/server';

/**
 * Phase 8 PR 2c + Phase 9 PR 1 — pathname-passthrough proxy.
 *
 * Originally shipped as `middleware.ts` / `export function
 * middleware(...)`. Renamed to `proxy.ts` / `export function
 * proxy(...)` per the Next 16 file-convention rename
 * (https://nextjs.org/docs/messages/middleware-to-proxy);
 * behaviour and matcher contract are unchanged.
 *
 * Next.js App Router server components do NOT receive
 * pathname directly. Two surfaces need it:
 *
 *   1. Phase 8 operator portal — must-change-password
 *      lockdown (Codex round 1 PR #42 P1 #1 fix). A
 *      `password_must_change=true` operator must be
 *      redirected to /operator/profile/password from EVERY
 *      route except the password page itself + logout.
 *
 *   2. Phase 9 client portal — `/me/:path*` reads the
 *      pathname for future must-change-password lockdown
 *      (Phase 9.x admin-mint magic-link flow). The hook is
 *      pre-wired in PR 1 even though the consumer logic
 *      lands later, mirroring the operator-side pattern.
 *
 * Injects `x-pathname` into the request headers so authed
 * layouts can read it via Next.js's `headers()` API and apply
 * redirects.
 */
export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/operator/:path*', '/me/:path*'],
};
