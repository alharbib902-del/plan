import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OutreachRow } from '@/components/admin/empty-legs/outreach-row';
import {
  countPendingOutreachOlderThan24h,
  getOutreachAlertStatus,
  listPendingOutreach,
} from '@/lib/admin/empty-legs/queries';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: emptyLegsAr.pageOutreachTitle,
  robots: { index: false, follow: false },
};

export default async function AdminEmptyLegsOutreachQueuePage() {
  if (process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false') {
    notFound();
  }

  const [rows, alertStatus, staleCount] = await Promise.all([
    listPendingOutreach(),
    getOutreachAlertStatus(),
    countPendingOutreachOlderThan24h(),
  ]);

  const showBanner =
    alertStatus !== null && alertStatus.status !== 'healthy';

  return (
    <section className="space-y-6">
      <header>
        <Link
          href="/admin/empty-legs"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          ← {emptyLegsAr.back}
        </Link>
        <h1 className="font-ar mt-2 text-2xl text-ink sm:text-3xl">
          {emptyLegsAr.pageOutreachTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {emptyLegsAr.pageOutreachSubtitle}
        </p>
      </header>

      {showBanner ? (
        <div
          role="alert"
          className="rounded-xl border border-red-400/40 bg-red-500/10 p-4"
        >
          <h2 className="font-ar text-sm text-red-200">
            {emptyLegsAr.outreachAlertBannerTitle} —{' '}
            {emptyLegsAr.outreachAlertBannerHint}
          </h2>
          {alertStatus.last_failure_reason ? (
            <p className="font-ar mt-2 text-xs text-red-300">
              {alertStatus.last_failure_reason}
            </p>
          ) : null}
          <p className="font-ar mt-2 text-xs text-red-300">
            {staleCount} {emptyLegsAr.outreachAlertPendingCount}
          </p>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {emptyLegsAr.outreachEmpty}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <OutreachRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
