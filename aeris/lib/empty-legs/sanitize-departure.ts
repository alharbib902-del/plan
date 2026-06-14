/**
 * Sanitizes a caller-supplied `departure` filter value before it is
 * interpolated into a PostgREST `.or(...)` clause in
 * `listPublicAvailableLegs` (lib/empty-legs/public-queries.ts).
 *
 * WHY this exists (security): supabase-js does NOT escape the raw string
 * passed to `.or()`. The departure value reaches this path from a PUBLIC
 * guest surface (GET /api/v1/mobile/public/empty-legs) and the public web
 * marketplace, so an attacker could embed PostgREST metacharacters
 * (comma, dot, parentheses, colon, quotes, backslash, LIKE wildcards) to
 * append extra OR filter clauses — a filter-injection surface. Flagged by
 * Codex as a non-blocking P3 hardening item on PR #149.
 *
 * The fix is a whitelist: keep only letters (ANY script — Aeris is
 * Arabic-first, so freeform departure labels can be Arabic), digits, and
 * spaces. Every PostgREST `.or()` metacharacter is ASCII punctuation and
 * is therefore stripped, while legitimate IATA codes (e.g. `RUH`) and
 * freeform Arabic/English labels (e.g. `الرياض`, `King Khalid`) pass
 * through unchanged — keeping behavior identical for legitimate input.
 *
 * Trade-off (intentional): the rare freeform label that contains
 * punctuation (e.g. a dot or hyphen) loses that character; since the
 * freeform side is a prefix `ilike` match this still matches sensibly.
 *
 * Note: case-folding for the IATA exact-match is applied by the caller
 * (`.toUpperCase()`), not here, so this stays a pure charset/length guard.
 */
export function sanitizeDepartureFilter(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()
    .slice(0, 64);
}
