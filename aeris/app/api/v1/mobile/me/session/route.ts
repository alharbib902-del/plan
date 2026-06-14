import { NextResponse } from 'next/server';

import { requireClientBearer } from '@/lib/mobile/auth';
import { mobileOk, mobilePreflight, withCors } from '@/lib/mobile/http';

/**
 * GET /api/v1/mobile/me/session
 *
 * The app calls this on launch to validate its stored token and
 * read the session context. This is ALSO the single detection
 * point for mid-session revocation and for `password_must_change`
 * (so `allowPasswordChange: true` — the app must be able to read
 * the flag in order to route the user to the change-password
 * screen).
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireClientBearer(req, { allowPasswordChange: true });
  if (!auth.ok) return withCors(req, auth.response);

  const s = auth.session;
  return withCors(
    req,
    mobileOk({
      session: {
        client_id: s.client_id,
        full_name: s.full_name,
        contact_phone: s.contact_phone,
        expires_at: s.expires_at,
        password_must_change: s.password_must_change,
      },
    })
  );
}

export function OPTIONS(req: Request): NextResponse {
  return mobilePreflight(req);
}
