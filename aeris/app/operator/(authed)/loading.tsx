/**
 * Operator-portal loading fallback — shown while an authed
 * /operator route segment renders on the server. Renders inside
 * the portal shell's <main>, so it centers within the page rather
 * than the full viewport. Server component; pure CSS animation.
 * Matches the root loading house style (aria-hidden spinner +
 * sr-only label).
 */
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div
          aria-hidden
          className="h-10 w-10 animate-spin rounded-full border-2 border-gold/30 border-t-gold"
        />
        <p className="font-ar text-sm text-ink-secondary">جارٍ التحميل…</p>
        <span className="sr-only">جارٍ التحميل</span>
      </div>
    </div>
  );
}
