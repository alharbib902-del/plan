/**
 * Phase 12 PR 3 — pure helpers for the
 * /api/cron/medevac/expire-certifications route.
 *
 * Extracted from the route so they can be tested under tsx
 * without Next.js / Supabase runtime dependencies. The route
 * imports + delegates to these.
 *
 * Three independent decisions per cert row per tick (D11):
 *   - isCertExpired()        → enforcement phase (flip all
 *                              supports_* to false)
 *   - shouldResetWarnings() → renewal-reset phase
 *                              (certification_expires_at > NOW()
 *                              + INTERVAL '30 days' AND any
 *                              warning flag set)
 *   - dueWarningThreshold() → warning-cascade phase
 *                              (returns the smallest threshold
 *                              N ∈ {30,14,7,1} such that the
 *                              cert expires within N days AND
 *                              warning_Nd_sent_at is NULL)
 */

export interface CertExpiryRow {
  certification_expires_at: string;
  supports_bmt: boolean;
  supports_als: boolean;
  supports_cct: boolean;
  supports_repatriation: boolean;
  warning_30d_sent_at: string | null;
  warning_14d_sent_at: string | null;
  warning_7d_sent_at: string | null;
  warning_1d_sent_at: string | null;
}

export type WarningThreshold = 30 | 14 | 7 | 1;
export const WARNING_THRESHOLDS: WarningThreshold[] = [30, 14, 7, 1];

export function thresholdColumn(t: WarningThreshold): keyof CertExpiryRow {
  switch (t) {
    case 30:
      return 'warning_30d_sent_at';
    case 14:
      return 'warning_14d_sent_at';
    case 7:
      return 'warning_7d_sent_at';
    case 1:
      return 'warning_1d_sent_at';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isCertExpired(
  row: Pick<CertExpiryRow, 'certification_expires_at'>,
  nowMs: number
): boolean {
  const expiry = Date.parse(row.certification_expires_at);
  return Number.isFinite(expiry) && expiry <= nowMs;
}

export function hasAnyCapability(
  row: Pick<
    CertExpiryRow,
    'supports_bmt' | 'supports_als' | 'supports_cct' | 'supports_repatriation'
  >
): boolean {
  return (
    row.supports_bmt ||
    row.supports_als ||
    row.supports_cct ||
    row.supports_repatriation
  );
}

export function hasAnyWarningFlag(
  row: Pick<
    CertExpiryRow,
    | 'warning_30d_sent_at'
    | 'warning_14d_sent_at'
    | 'warning_7d_sent_at'
    | 'warning_1d_sent_at'
  >
): boolean {
  return (
    row.warning_30d_sent_at !== null ||
    row.warning_14d_sent_at !== null ||
    row.warning_7d_sent_at !== null ||
    row.warning_1d_sent_at !== null
  );
}

/**
 * Returns true iff certification_expires_at is more than 30
 * days in the future AND at least one warning flag is set.
 * Round 4 PR #75 P2 #4 fix — the > 30 day floor prevents a
 * mid-warning-window renewal from resetting the flags and
 * spamming the cascade on the next cron tick.
 */
export function shouldResetWarnings(
  row: CertExpiryRow,
  nowMs: number
): boolean {
  const expiry = Date.parse(row.certification_expires_at);
  if (!Number.isFinite(expiry)) return false;
  if (expiry <= nowMs + 30 * DAY_MS) return false;
  return hasAnyWarningFlag(row);
}

/**
 * Returns the smallest threshold (in days) such that the
 * cert expires within that window AND the matching flag is
 * still NULL. Used to fire the warning email exactly once
 * per threshold per renewal cycle. Returns null if no
 * threshold is due OR if the cert has already expired
 * (in which case the enforcement phase takes over).
 */
export function dueWarningThreshold(
  row: CertExpiryRow,
  nowMs: number
): WarningThreshold | null {
  const expiry = Date.parse(row.certification_expires_at);
  if (!Number.isFinite(expiry)) return null;
  if (expiry <= nowMs) return null;
  const daysOut = (expiry - nowMs) / DAY_MS;
  for (const t of WARNING_THRESHOLDS) {
    const col = thresholdColumn(t);
    if (daysOut <= t && row[col] === null) {
      return t;
    }
  }
  return null;
}
