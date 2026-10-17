/**
 * Shared Arabic date/time formatter for every user-facing timestamp.
 *
 * A bare `'ar-SA'` formatter renders Arabic-Indic digits (and Hijri
 * dates on ICU builds whose ar-SA default calendar is Umm al-Qura), and
 * without `timeZone` it formats in the runtime zone — UTC on Vercel,
 * the viewer's zone in the browser — so times drift by 3h and a client
 * component's server and browser renders disagree (hydration mismatch).
 * CLAUDE.md mandates Gregorian + Western digits + Asia/Riyadh, so those
 * three options are forced here and callers cannot override them.
 */

export type RiyadhFormatOptions = Omit<
  Intl.DateTimeFormatOptions,
  'calendar' | 'numberingSystem' | 'timeZone'
>;

export function formatInRiyadh(
  value: Date | string | number | null | undefined,
  options: RiyadhFormatOptions,
  emptyLabel = '—'
): string {
  if (value === null || value === undefined || value === '') return emptyLabel;
  const date = value instanceof Date ? value : new Date(value);
  // Unparseable input is shown verbatim rather than as "Invalid Date",
  // matching the try/catch fallback the per-file formatters used.
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : emptyLabel;
  }
  return new Intl.DateTimeFormat('ar-SA', {
    ...options,
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'Asia/Riyadh',
  }).format(date);
}
