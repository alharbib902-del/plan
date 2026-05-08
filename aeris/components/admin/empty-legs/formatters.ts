/**
 * Phase 7 — small shared formatters for the Empty Legs
 * admin pages. Kept separate from `components/...` so the
 * page modules can import them without pulling in JSX.
 */

export function formatSarAmount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}%`;
}

// Codex round-1 P2 #1 fix. Phase 7's invariant is that
// every customer/admin-facing operational timestamp
// renders in Asia/Riyadh (per CLAUDE.md). Leaving
// `timeZone` unset would render UTC on Vercel server
// components and the viewer's local zone in the browser
// — departure windows could be several hours off the
// truth. Pin the formatter to Riyadh time explicitly.
export function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatDateAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function routeLabel(
  iata: string | null,
  freeform: string | null
): string {
  if (iata && iata.trim().length > 0) return iata;
  if (freeform && freeform.trim().length > 0) return freeform;
  return '—';
}

/**
 * Codex round-2 P2 #1 fix. `<input type="datetime-local">`
 * yields a string with no timezone (e.g. `2026-05-09T18:30`).
 * Passing it to `new Date(...)` interprets the wall-clock
 * value in the BROWSER's local zone — so a founder/admin
 * outside Riyadh would publish a leg shifted by their local
 * offset, even though the rest of the surface renders
 * everything in Asia/Riyadh per Phase 7's invariant.
 *
 * Saudi Arabia is fixed UTC+03:00 (no DST), so we append
 * the offset explicitly to interpret the input as Riyadh
 * wall time regardless of the admin's browser. Use this
 * helper for every form input that ships datetime-local
 * values to a SECURITY DEFINER RPC.
 */
export function datetimeLocalToRiyadhIso(localValue: string): string {
  const trimmed = localValue.trim();
  // datetime-local can be `YYYY-MM-DDTHH:mm` (16 chars) or
  // `YYYY-MM-DDTHH:mm:ss` (19). Pad the seconds when
  // missing so the resulting ISO is uniform.
  const withSeconds = /\d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? trimmed
    : `${trimmed}:00`;
  return `${withSeconds}+03:00`;
}
