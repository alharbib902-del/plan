import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { listOperatorMyCargoOffers } from '@/lib/cargo/queries/operator-list';
import { WithdrawOfferButton } from '@/components/cargo/operator-actions';
import { cargoAr } from '@/lib/i18n/cargo-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.operatorMyOffersTitle,
  robots: { index: false, follow: false },
};

function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
      timeStyle: 'short',
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

export default async function OperatorMyCargoOffersPage() {
  if (process.env.ENABLE_CARGO !== 'true') notFound();
  noStore();

  const session = await requireOperatorSession();
  const offers = await listOperatorMyCargoOffers(session.operator_id);

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {cargoAr.operatorMyOffersTitle}
          </h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            {cargoAr.operatorMyOffersSubtitle}
          </p>
        </div>
        <Link
          href="/operator/cargo"
          className="font-ar inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-navy-card/60 px-4 py-2 text-sm text-ink-secondary transition-colors hover:bg-navy-card/80 hover:text-gold-light"
        >
          {cargoAr.operatorListPageTitle} ←
        </Link>
      </header>

      {offers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {cargoAr.operatorMyOffersEmpty}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-navy-card/40">
              <tr>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorMyOffersTableRequest}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorMyOffersTableSubmittedAt}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorMyOffersTableTotal}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.operatorMyOffersTableStatus}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.adminQueueTableActions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-navy-card/20">
              {offers.map((o) => (
                <tr key={o.id} className="hover:bg-navy-card/40">
                  <td
                    dir="ltr"
                    className="px-4 py-3 font-mono text-sm text-gold-light"
                  >
                    {o.cargo_request_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">
                    {formatDateTimeAr(o.created_at)}
                  </td>
                  <td
                    dir="ltr"
                    className="px-4 py-3 text-sm text-ink-secondary"
                  >
                    {formatSAR(o.total_price_sar)} SAR
                  </td>
                  <td className="font-ar px-4 py-3 text-sm text-ink-secondary">
                    {cargoAr.statusLabels[o.status] ?? o.status}
                  </td>
                  <td className="px-4 py-3">
                    {o.status === 'pending' ? (
                      <WithdrawOfferButton offerId={o.id} />
                    ) : (
                      <span className="font-ar text-xs text-ink-muted">—</span>
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
