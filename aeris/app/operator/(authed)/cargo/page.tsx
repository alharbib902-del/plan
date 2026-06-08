import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import {
  listOperatorAvailableCargoRequests,
  formatCargoRoute,
} from '@/lib/cargo/queries/operator-list';
import { cargoAr } from '@/lib/i18n/cargo-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.operatorListPageTitle,
  robots: { index: false, follow: false },
};

function formatDateAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatSAR(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    numeric
  );
}

export default async function OperatorCargoListPage() {
  if (process.env.ENABLE_CARGO !== 'true') notFound();
  noStore();

  const session = await requireOperatorSession();
  // Note: password_must_change is enforced at Server Action layer
  // (per Round 2 spec fix). The page itself is read-only and shows
  // an alert banner instead of blocking the read; founder decided
  // PR 2 keeps the single guard at the action level.

  const rows = await listOperatorAvailableCargoRequests(session.operator_id);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {cargoAr.operatorListPageTitle}
          </h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            {cargoAr.operatorListPageSubtitle}
          </p>
        </div>
        <Link
          href="/operator/cargo/offers"
          className="font-ar inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-navy-card/60 px-4 py-2 text-sm text-ink-secondary transition-colors hover:bg-navy-card/80 hover:text-gold-light"
        >
          {cargoAr.operatorListMyOffersCta}
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {cargoAr.operatorListEmpty}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-navy-card/40">
              <tr>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorListTableNumber}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorListTableType}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorListTableRoute}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorListTablePickup}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorListTableValue}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.adminQueueTableActions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-navy-card/20">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-navy-card/40">
                  <td className="px-4 py-3 font-mono text-sm text-gold-light">
                    <span dir="ltr">{row.cargo_request_number}</span>
                  </td>
                  <td className="font-ar px-4 py-3 text-sm text-ink">
                    {cargoAr.cargoTypes[row.cargo_type] ?? row.cargo_type}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">
                    <span dir="ltr">{formatCargoRoute(row)}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">
                    {formatDateAr(row.pickup_date)}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">
                    <span dir="ltr">{formatSAR(row.estimated_value_sar)} ريال</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.pending_offer_from_me ? (
                      <span className="font-ar text-xs text-ink-muted">
                        ✓ {cargoAr.statusLabels.pending}
                      </span>
                    ) : (
                      <Link
                        href={`/operator/cargo/${row.id}/offer`}
                        className="font-ar text-sm text-gold-light hover:text-gold"
                      >
                        {cargoAr.operatorListSubmitOfferCta}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
