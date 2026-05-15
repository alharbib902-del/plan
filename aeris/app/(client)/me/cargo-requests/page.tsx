import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';

import { requireClientSession } from '@/lib/clients/auth';
import { listMyCargoRequests } from '@/lib/cargo/queries/client-list';
import { cargoAr } from '@/lib/i18n/cargo-ar';
import type { CargoRequestRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 2 — authed client cargo requests list.
 *
 * Mirrors /me/requests (Phase 9) shape: header + table + empty
 * state + "new request" CTA. Gated behind ENABLE_CARGO flag
 * (404 when off — defense-in-depth alongside the Server Action's
 * flag_disabled return).
 *
 * Auth: requireClientSession() throws NEXT_REDIRECT to /login on
 * missing/invalid cookie. The double-check + null-redirect dance
 * matches the Phase 10 /me/empty-legs page pattern.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.meListPageTitle,
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

function routeLabel(row: CargoRequestRow): string {
  const dep = row.origin_iata ?? row.origin_freeform ?? '—';
  const arr = row.destination_iata ?? row.destination_freeform ?? '—';
  return `${dep} → ${arr}`;
}

export default async function MyCargoRequestsPage() {
  if (process.env.ENABLE_CARGO !== 'true') notFound();
  noStore();

  const session = await requireClientSession();
  if (!session) redirect('/login?redirect=/me/cargo-requests');

  const rows = await listMyCargoRequests(session.client_id);

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {cargoAr.meListPageTitle}
          </h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            {cargoAr.meListPageSubtitle}
          </p>
        </div>
        <Link
          href="/me/cargo-requests/new"
          className="font-ar shrink-0 rounded-lg border border-gold/50 bg-gold/15 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/25"
        >
          {cargoAr.meListNewRequestCta}
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">{cargoAr.meListEmpty}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-navy-card/40">
              <tr>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.meListTableNumber}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.meListTableType}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.meListTableRoute}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.meListTablePickup}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.meListTableStatus}
                </th>
                <th className="font-ar px-4 py-3 text-start text-xs font-medium text-ink-muted">
                  {cargoAr.meListTableActions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-navy-card/20">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-navy-card/40">
                  <td
                    dir="ltr"
                    className="px-4 py-3 font-mono text-sm text-gold-light"
                  >
                    {row.cargo_request_number}
                  </td>
                  <td className="font-ar px-4 py-3 text-sm text-ink">
                    {cargoAr.cargoTypes[row.cargo_type] ?? row.cargo_type}
                  </td>
                  <td
                    dir="ltr"
                    className="px-4 py-3 text-sm text-ink-secondary"
                  >
                    {routeLabel(row)}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-secondary">
                    {formatDateAr(row.pickup_date)}
                  </td>
                  <td className="font-ar px-4 py-3 text-sm text-ink-secondary">
                    {cargoAr.statusLabels[row.status] ?? row.status}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/me/cargo-requests/${row.id}`}
                      className="font-ar text-sm text-gold-light hover:text-gold"
                    >
                      {cargoAr.meListViewDetails}
                    </Link>
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
