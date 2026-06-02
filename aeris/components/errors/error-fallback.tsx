'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

/**
 * Shared branded error card (Arabic RTL). Used by every route-segment
 * error.tsx so the user never sees Next.js's unstyled English error
 * page. Mirrors the offline-card visual language (navy + gold, centred
 * card). Client component — error boundaries must be Client Components,
 * and the retry button + logging need the browser.
 */
export function ErrorFallback({
  error,
  reset,
  homeHref = '/',
  homeLabel = 'العودة للرئيسية',
  title = 'حدث خطأ غير متوقّع',
  description = 'نعتذر، واجهنا مشكلة أثناء تحميل هذه الصفحة. جرّب إعادة المحاولة، وإن استمرّت المشكلة تواصل معنا عبر واتساب.',
}: {
  error?: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
  homeLabel?: string;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    // TODO(REA-01): replace with a real captureException once error
    // monitoring (Sentry / Vercel Log Drains) is wired in the next P0 PR.
    // Until then this at least surfaces the digest in the browser console.
    console.error('[error-boundary]', error);
  }, [error]);

  return (
    <main className="relative min-h-screen bg-navy">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, rgba(201,169,97,0.08), transparent 60%), linear-gradient(180deg, #050B14 0%, #0A1628 100%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury">
          <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
            <AlertTriangle className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="font-ar text-xl text-ink">{title}</h1>
          <p className="font-ar mt-3 text-sm leading-7 text-ink-secondary">
            {description}
          </p>
          {error?.digest ? (
            <p
              className="font-ar mt-2 text-xs text-ink-secondary/70"
              dir="ltr"
            >
              ref: {error.digest}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="font-ar inline-flex min-h-[44px] items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
            >
              إعادة المحاولة
            </button>
            <Link
              href={homeHref}
              className="font-ar inline-flex min-h-[44px] items-center justify-center rounded-md border border-gold/20 px-5 py-2 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-ink"
            >
              {homeLabel}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
