import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { listAdminCargoQueue } from '@/lib/cargo/queries/admin-queue';
import { cargoAr } from '@/lib/i18n/cargo-ar';
import type { CargoRequestRow } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 — admin cargo queue.
 *
 * Lists all pending + offers_received cargo requests sorted
 * by pickup_date ascending (urgency proxy).
 *
 * Read-only in PR 1; PR 2 adds accept/decline buttons via the
 * detail page admin affordances.
 *
 * Gated behind ENABLE_CARGO env flag (404 when off, mirrors
 * Phase 10 admin gating discipline).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.adminQueueTitle,
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

function routeLabel(row: CargoRequestRow): string {
  const dep = row.origin_iata ?? row.origin_freeform ?? '—';
  const arr = row.destination_iata ?? row.destination_freeform ?? '—';
  return `${dep} → ${arr}`;
}

export default async function AdminCargoQueuePage() {
  if (process.env.ENABLE_CARGO !== 'true') notFound();

  const rows = await listAdminCargoQueue();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {cargoAr.adminQueueTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {cargoAr.adminQueueSubtitle}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {cargoAr.adminQueueEmpty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="font-ar w-full text-right text-sm">
            <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
              <tr>
                <Th>{cargoAr.adminQueueTableNumber}</Th>
                <Th>{cargoAr.adminQueueTableType}</Th>
                <Th>{cargoAr.adminQueueTableRoute}</Th>
                <Th>{cargoAr.adminQueueTablePickupDate}</Th>
                <Th>{cargoAr.adminQueueTableValue}</Th>
                <Th>{cargoAr.adminQueueTableStatus}</Th>
                <Th>{cargoAr.adminQueueTableActions}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-border/60 hover:bg-navy-secondary/40"
                >
                  <Td>
                    <span dir="ltr" className="text-ink-primary">
                      {row.cargo_request_number}
                    </span>
                  </Td>
                  <Td>{cargoAr.cargoTypes[row.cargo_type] ?? row.cargo_type}</Td>
                  <Td>
                    <span dir="ltr">{routeLabel(row)}</span>
                  </Td>
                  <Td>{formatDateAr(row.pickup_date)}</Td>
                  <Td>{formatSAR(row.estimated_value_sar)}</Td>
                  <Td>
                    <span className="text-gold-light">
                      {cargoAr.statusLabels[row.status] ?? row.status}
                    </span>
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/cargo/${row.id}`}
                      className="text-gold-light hover:text-gold"
                    >
                      {cargoAr.adminQueueViewDetails}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-middle">{children}</td>;
}
