import 'server-only';

import { headers } from 'next/headers';

/**
 * Transport-neutral request context for the client core
 * functions in `lib/clients/core/*`.
 *
 * The core functions (e.g. `runClientLogin`) must NOT reach
 * for `cookies()`/`redirect()` or assume a Server-Action vs
 * route-handler caller — they take the already-resolved IP +
 * user-agent here. Both the web Server Actions
 * (`app/actions/clients-public.ts`) and the mobile route
 * handlers (`app/api/v1/mobile/*`) resolve this the same way,
 * so the audit trail (`p_ip` / `p_user_agent` on session +
 * signup RPCs) is identical across surfaces.
 */
export interface ClientRequestContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Resolve the caller IP + user-agent from the incoming request
 * headers. Mirrors the prior inline `clientIp()`/`userAgent()`
 * helpers in `clients-public.ts`: first XFF hop, then x-real-ip.
 * Never throws — a header read failure degrades to `null` so a
 * missing-IP path (e.g. signup `ip_required`) fires by contract
 * rather than crashing.
 */
export async function resolveClientRequestContext(): Promise<ClientRequestContext> {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    const xf = h.get('x-forwarded-for');
    if (xf) {
      ip = xf.split(',')[0]!.trim();
    } else {
      const xr = h.get('x-real-ip');
      if (xr) ip = xr.trim();
    }
    userAgent = h.get('user-agent');
  } catch {
    // Headers unavailable — leave both null.
  }
  return { ip, userAgent };
}
