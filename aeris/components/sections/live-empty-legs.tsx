import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PublicLegCard } from '@/components/public/empty-legs/leg-card';
import { listPublicAvailableLegs } from '@/lib/empty-legs/public-queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

// Fail-soft: the home page must never break because the legs read
// failed — the section degrades to the marketing copy + CTA without
// live cards.
async function readLegsSafe(): Promise<EmptyLegRow[]> {
  try {
    return await listPublicAvailableLegs({ limit: 3 });
  } catch {
    return [];
  }
}

export async function LiveEmptyLegs() {
  const legs = await readLegsSafe();

  return (
    <section className="bg-navy py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <span className="font-ar inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-emerald-300">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
              />
              متاح الآن
            </span>
            <h2 className="font-ar mt-6 text-3xl leading-tight text-ink sm:text-4xl">
              {emptyLegsAr.homeEmptyLegsCtaTitle}
            </h2>
            <p className="font-ar mt-4 text-sm leading-7 text-ink-secondary sm:text-base">
              {emptyLegsAr.homeEmptyLegsCtaSubtitle} الأسعار ديناميكية وتنخفض
              تلقائياً كلما اقترب موعد الإقلاع.
            </p>
          </div>
          <Link
            href="/empty-legs"
            className="font-ar inline-flex shrink-0 items-center gap-2 rounded-md border border-gold/40 px-6 py-3 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/10"
          >
            {emptyLegsAr.homeEmptyLegsCtaButton}
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
        </div>

        {legs.length > 0 ? (
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {legs.map((leg) => (
              <PublicLegCard key={leg.id} leg={leg} />
            ))}
          </div>
        ) : (
          <p className="font-ar mt-12 rounded-xl border border-dashed border-border bg-navy-card/30 p-8 text-center text-sm text-ink-muted">
            لا توجد رحلات معروضة في هذه اللحظة — فعّل التنبيهات من حسابك
            لتكون أول من يعرف عند نشر رحلة جديدة.
          </p>
        )}
      </div>
    </section>
  );
}

export function LiveEmptyLegsSkeleton() {
  return (
    <section className="bg-navy py-20 sm:py-24" aria-hidden>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="h-7 w-32 animate-pulse rounded-full bg-navy-card/60" />
        <div className="mt-6 h-9 w-2/3 max-w-md animate-pulse rounded-lg bg-navy-card/60" />
        <div className="mt-4 h-5 w-full max-w-xl animate-pulse rounded-lg bg-navy-card/40" />
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-2xl border border-border bg-navy-card/40"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
