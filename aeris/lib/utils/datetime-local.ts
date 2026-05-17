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

/**
 * Codex round 4 PR #76 P2 #1 fix — reverse helper that
 * formats a stored ISO instant as a naive
 * `YYYY-MM-DDTHH:mm` string IN ASIA/RIYADH wall clock for
 * pre-filling an `<input type="datetime-local">`.
 *
 * Symmetric to {@link datetimeLocalToRiyadhIso}: the forward
 * helper writes Riyadh wall time → ISO, this reverse helper
 * reads ISO → Riyadh wall time. Both sides use the SAME zone
 * so an admin in any timezone can load an existing row,
 * leave the value untouched, and save it back without the
 * timestamp drifting by their local offset.
 *
 * The previous in-component implementation in
 * cert-matrix-editor.tsx used `new Date(iso).getHours()` etc.
 * which read the BROWSER zone — a non-Riyadh admin would
 * see (and re-save) a value shifted by their local offset.
 *
 * Returns `''` for any unparseable input so the caller can
 * leave the input empty.
 */
export function riyadhIsoToDatetimeLocal(iso: string): string {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA uses ISO-style `YYYY-MM-DD HH:MM` separators, which
  // makes the parts trivially recombinable into the
  // datetime-local format.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // Some Node/Chromium versions emit `24` for midnight under
  // `hour12: false`; normalise to `00` so the datetime-local
  // input accepts it.
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const minute = get('minute');
  if (!year || !month || !day || !hour || !minute) return '';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}
