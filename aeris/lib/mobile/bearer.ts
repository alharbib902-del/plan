/**
 * Pure Bearer-token parsing.
 *
 * Deliberately NO `'server-only'` import and NO next imports —
 * same rationale as `lib/empty-legs/pricing-visibility.ts` — so
 * the tsx unit suite can import it directly outside Next.js.
 * Re-exported from `lib/mobile/auth.ts` for the server callers.
 */
export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}
