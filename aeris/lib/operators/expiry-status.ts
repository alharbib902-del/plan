/**
 * Licence/document expiry classification for the operator portal.
 *
 * Isomorphic (pure functions, no directive) so client components can
 * import it. "Today" is passed in as a Riyadh calendar date so server
 * and client renders agree and tests stay deterministic.
 */

export type ExpiryStatus = 'expired' | 'expiring_soon' | 'valid';

export const EXPIRY_SOON_DAYS = 30;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const RIYADH_ISO_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Riyadh',
});

/** Today's calendar date in Asia/Riyadh as `YYYY-MM-DD`. */
export function riyadhTodayIsoDate(now: Date = new Date()): string {
  return RIYADH_ISO_DATE.format(now);
}

function isoDateToUtcDay(value: string): number | null {
  const m = ISO_DATE_RE.exec(value.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms / 86_400_000;
}

/**
 * Classify a `date` column against today's Riyadh date. The expiry day
 * itself still counts as valid (expires at the end of that day).
 * Returns null for a missing or unparseable value.
 */
export function classifyExpiry(
  expiryDate: string | null | undefined,
  todayIsoDate: string
): ExpiryStatus | null {
  if (!expiryDate) return null;
  const expiryDay = isoDateToUtcDay(expiryDate);
  const today = isoDateToUtcDay(todayIsoDate);
  if (expiryDay === null || today === null) return null;
  const daysLeft = expiryDay - today;
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= EXPIRY_SOON_DAYS) return 'expiring_soon';
  return 'valid';
}
