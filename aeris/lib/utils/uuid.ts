/**
 * Codex round 1 PR #57 P2 #1 fix — shared UUID-shape guard
 * for any code path that takes a route param (or other
 * untrusted string) and ships it into a Postgres UUID
 * column. Without this guard, PostgREST rejects the
 * comparison with a 22P02 invalid_text_representation,
 * the calling helper throws, and the page renders a 500
 * instead of the intended not-found / opaque state.
 *
 * Contract: lowercase or uppercase hex, 8-4-4-4-12 layout
 * (the canonical RFC 4122 shape PostgreSQL accepts). We
 * intentionally do NOT enforce a specific version nibble
 * (v4 vs v5 vs v7) — Postgres `uuid` accepts any version,
 * and the table generators are spread across `uuid_generate_v4`
 * (Phase 1) and `uuid_generate_v7` (some Phase 8 surfaces).
 */
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}
