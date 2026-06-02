/**
 * Root loading fallback — shown during server rendering of route
 * segments so users see a branded spinner instead of a blank screen.
 * Server component; pure CSS animation.
 */
export default function Loading() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-navy">
      <div className="flex flex-col items-center gap-4">
        <div
          aria-hidden
          className="h-10 w-10 animate-spin rounded-full border-2 border-gold/30 border-t-gold"
        />
        <p className="font-ar text-sm text-ink-secondary">جارٍ التحميل…</p>
        <span className="sr-only">جارٍ التحميل</span>
      </div>
    </main>
  );
}
