/**
 * Phase 12 PR 3 — pure parser for PostgREST INTERVAL strings.
 *
 * Extracted from /api/cron/medevac/sla-escalation/route.ts so
 * the parse logic can be tested in isolation. The §3.6
 * medevac_severity_sla lookup stores INTERVAL values; PostgREST
 * returns them as strings in one of a few shapes depending on
 * server config. This helper normalises to a single number
 * (minutes) the route uses for budget math.
 */

/**
 * Parses a PostgREST INTERVAL string into minutes. Handles:
 *   - 'HH:MM:SS' / 'HH:MM:SS.SSS'   (default Postgres display)
 *   - 'P1H' / 'PT1H' / 'PT24H'      (ISO 8601 simple cases)
 *   - 'X hours' / 'X minutes'        (verbose)
 *   - Bare number (interpreted as seconds → minutes)
 *
 * Returns 0 for any unrecognised input so the caller can
 * treat 0 as "skip this row" rather than crash.
 */
export function parseSlaIntervalMinutes(s: string): number {
  if (!s) return 0;
  const trimmed = s.trim();
  // HH:MM:SS or HH:MM:SS.SSS
  const hms = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (hms) {
    const h = Number(hms[1]);
    const m = Number(hms[2]);
    const sec = Number(hms[3]);
    return h * 60 + m + sec / 60;
  }
  // PT?XH / PT?XM (ISO 8601 simple)
  const iso = /^P?T?(\d+)([HM])$/.exec(trimmed);
  if (iso) {
    const n = Number(iso[1]);
    return iso[2] === 'H' ? n * 60 : n;
  }
  // Verbose 'X hours' or 'X minutes'
  const hours = /^(\d+(?:\.\d+)?)\s*hours?$/i.exec(trimmed);
  if (hours) return Number(hours[1]) * 60;
  const mins = /^(\d+(?:\.\d+)?)\s*min(?:ute)?s?$/i.exec(trimmed);
  if (mins) return Number(mins[1]);
  // Fallback — bare seconds
  const n = Number(trimmed);
  if (Number.isFinite(n)) return n / 60;
  return 0;
}
