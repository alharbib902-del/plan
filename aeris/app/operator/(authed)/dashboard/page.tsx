import type { Metadata } from 'next';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import {
  getOperatorRowById,
  getOperatorDashboardStats,
} from '@/lib/operators/session-store';
import { OperatorDashboardCards } from '@/components/operator/dashboard-cards';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.dashboard.title,
  robots: { index: false, follow: false },
};

export default async function OperatorDashboardPage() {
  const session = await requireOperatorSession();
  const [operator, stats] = await Promise.all([
    getOperatorRowById(session.operator_id),
    getOperatorDashboardStats(session.operator_id),
  ]);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {operatorsAr.portal.dashboard.title}
          </h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            {operator
              ? operatorsAr.portal.dashboard.welcomeLine(operator.company_name)
              : ''}
          </p>
        </div>
        <Link
          href="/operator/legs/new"
          className="font-ar inline-flex items-center justify-center rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25"
        >
          {operatorsAr.portal.dashboard.addLeg}
        </Link>
      </header>

      <OperatorDashboardCards stats={stats} />

      {stats.active_legs + stats.reserved_legs + stats.sold_legs === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {operatorsAr.portal.dashboard.empty}
          </p>
        </div>
      ) : null}
    </section>
  );
}
