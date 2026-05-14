/**
 * Codex round-2 P2 #1 fix (Phase 7) + round 1 P2 #3 fix
 * (Phase 9 PR 2). Shared helper for converting an HTML
 * `<input type="datetime-local">` value into an ISO instant
 * pinned to Asia/Riyadh.
 *
 * `<input type="datetime-local">` yields a naive string with
 * no timezone (e.g. `2026-05-09T18:30`). Passing it to
 * `new Date(...)` interprets the wall-clock value in the
 * BROWSER's local zone — so a user outside Riyadh would
 * submit a value shifted by their local offset, even though
 * the rest of the surface renders everything in Asia/Riyadh
 * per the Phase 7 invariant.
 *
 * Saudi Arabia is fixed UTC+03:00 (no DST), so we append the
 * offset explicitly to interpret the input as Riyadh wall
 * time regardless of the user's browser. Use this helper for
 * EVERY form input that ships a datetime-local value to a
 * SECURITY DEFINER RPC (operator publish form, admin
 * publish form, Phase 9 charter form, …).
 */
export function datetimeLocalToRiyadhIso(localValue: string): string {
  const trimmed = localValue.trim();
  // datetime-local can be `YYYY-MM-DDTHH:mm` (16 chars) or
  // `YYYY-MM-DDTHH:mm:ss` (19). Pad the seconds when missing
  // so the resulting ISO is uniform.
  const withSeconds = /\d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? trimmed
    : `${trimmed}:00`;
  return `${withSeconds}+03:00`;
}
