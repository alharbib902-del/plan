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
 * Codex round-2 P2 #1 fix (Phase 7). Re-exported from the
 * shared utility module after Phase 9 PR 2 round 1 P2 #3 —
 * the same helper now serves the client charter form.
 */
export { datetimeLocalToRiyadhIso } from '@/lib/utils/datetime-local';
