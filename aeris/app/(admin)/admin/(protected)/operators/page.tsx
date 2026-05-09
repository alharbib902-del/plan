import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OperatorListFilters } from '@/components/admin/operators/list-filters';
import { OperatorRow } from '@/components/admin/operators/operator-row';
import {
  countOperatorsByStatus,
  listOperators,
  OPERATOR_SIGNUP_STATUSES,
  type OperatorListFilter,
} from '@/lib/admin/operators/queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.adminListTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams?: { filter?: string };
}

function parseFilter(raw: string | undefined): OperatorListFilter {
  if (!raw) return 'all';
  const lowered = raw.toLowerCase();
  if (lowered === 'all') return 'all';
  if ((OPERATOR_SIGNUP_STATUSES as readonly string[]).includes(lowered)) {
    return lowered as OperatorListFilter;
  }
  return 'all';
}

export default async function AdminOperatorsPage({ searchParams }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'false') {
    notFound();
  }

  const filter = parseFilter(searchParams?.filter);
  const [operators, counts] = await Promise.all([
    listOperators({ filter, limit: 200 }),
    countOperatorsByStatus(),
  ]);

  const isFiltered = filter !== 'all';
  const emptyMessage = isFiltered
    ? operatorsAr.adminListEmptyForFilter
    : operatorsAr.adminListEmpty;

  return (
    <section>
      <div className="mb-6">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.adminListTitle}
        </h1>
      </div>

      <div className="mb-6">
        <OperatorListFilters active={filter} counts={counts} />
      </div>

      {operators.length === 0 ? (
        <div className="rounded-xl border border-border bg-navy-card/40 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {operators.map((op) => (
            <OperatorRow key={op.id} operator={op} />
          ))}
        </div>
      )}
    </section>
  );
}
