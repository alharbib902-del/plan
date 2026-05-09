import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicLegCard } from '@/components/public/empty-legs/leg-card';
import {
  listDistinctDepartures,
  listPublicAvailableLegs,
} from '@/lib/empty-legs/public-queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.publicListTitle,
  description: emptyLegsAr.publicListSubtitle,
};

interface PageProps {
  searchParams?: {
    departure?: string;
    minPassengers?: string;
    maxPrice?: string;
  };
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default async function PublicEmptyLegsListPage({
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE !== 'true') {
    notFound();
  }

  const departure = searchParams?.departure?.trim() || null;
  const minPassengers = parseNumber(searchParams?.minPassengers);
  const maxPrice = parseNumber(searchParams?.maxPrice);

  const [legs, distinctDepartures] = await Promise.all([
    listPublicAvailableLegs({
      departure,
      minPassengers,
      maxPrice,
      limit: 50,
    }),
    listDistinctDepartures(),
  ]);

  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 pt-28 sm:px-6 lg:px-8">
      <header className="mb-8">
        <h1 className="font-ar text-3xl text-ink sm:text-4xl">
          {emptyLegsAr.publicListTitle}
        </h1>
        <p className="font-ar mt-2 text-base text-ink-secondary">
          {emptyLegsAr.publicListSubtitle}
        </p>
      </header>

      <form
        method="get"
        className="mb-8 grid gap-3 rounded-xl border border-border bg-navy-card/40 p-4 sm:grid-cols-3"
      >
        <div>
          <label
            htmlFor="departure"
            className="font-ar mb-1 block text-xs text-ink-muted"
          >
            {emptyLegsAr.publicListFilterDeparture}
          </label>
          <select
            id="departure"
            name="departure"
            defaultValue={departure ?? ''}
            className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
          >
            <option value="">
              {emptyLegsAr.publicListFilterAny}
            </option>
            {distinctDepartures.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="minPassengers"
            className="font-ar mb-1 block text-xs text-ink-muted"
          >
            {emptyLegsAr.publicListFilterPassengers}
          </label>
          <input
            id="minPassengers"
            name="minPassengers"
            type="number"
            min={1}
            max={19}
            defaultValue={minPassengers ?? ''}
            className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="maxPrice"
            className="font-ar mb-1 block text-xs text-ink-muted"
          >
            {emptyLegsAr.publicListFilterMaxPrice}
          </label>
          <input
            id="maxPrice"
            name="maxPrice"
            type="number"
            min={0}
            step="500"
            defaultValue={maxPrice ?? ''}
            className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-end justify-end gap-2 sm:col-span-3">
          <a
            href="/empty-legs"
            className="font-ar inline-flex items-center gap-2 rounded-md border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light"
          >
            {emptyLegsAr.publicListFilterClear}
          </a>
          <button
            type="submit"
            className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/15"
          >
            {emptyLegsAr.publicListFilterApply}
          </button>
        </div>
      </form>

      {legs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-base text-ink-muted">
            {emptyLegsAr.publicListEmpty}
          </p>
        </div>
      ) : (
        <>
          <p className="font-ar mb-4 text-xs uppercase tracking-tagged text-ink-muted">
            {emptyLegsAr.publicListMostUrgent}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {legs.map((leg) => (
              <PublicLegCard key={leg.id} leg={leg} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
