import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyLegsListFilters } from '@/components/admin/empty-legs/list-filters';
import { EmptyLegsTable } from '@/components/admin/empty-legs/leg-row';
import {
  countEmptyLegsByStatus,
  EMPTY_LEG_STATUSES,
  listEmptyLegs,
  type EmptyLegListFilter,
} from '@/lib/admin/empty-legs/queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.pageListTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams?: { status?: string };
}

function parseFilter(raw: string | undefined): EmptyLegListFilter {
  if (!raw) return 'open';
  const lowered = raw.toLowerCase();
  if (lowered === 'open' || lowered === 'all') return lowered;
  if ((EMPTY_LEG_STATUSES as readonly string[]).includes(lowered)) {
    return lowered as EmptyLegListFilter;
  }
  return 'open';
}

export default async function AdminEmptyLegsPage({ searchParams }: PageProps) {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

  const filter = parseFilter(searchParams?.status);
  const [legs, counts] = await Promise.all([
    listEmptyLegs({ filter, limit: 200 }),
    countEmptyLegsByStatus(),
  ]);

  return (
    <section>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink sm:text-3xl">
            {emptyLegsAr.pageListTitle}
          </h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            {emptyLegsAr.pageListSubtitle}
          </p>
        </div>
        <Link
          href="/admin/empty-legs/new"
          className="font-ar inline-flex items-center gap-2 self-start rounded-md border border-gold bg-gold/10 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/15"
        >
          {emptyLegsAr.formSubmitPublish}
        </Link>
      </div>

      <div className="mb-6">
        <EmptyLegsListFilters current={filter} counts={counts} />
      </div>

      <EmptyLegsTable legs={legs} />
    </section>
  );
}
