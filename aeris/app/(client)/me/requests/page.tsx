import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RequestsTable } from '@/components/clients/requests-table';
import { requireClientSession } from '@/lib/clients/auth';
import { clientsAr } from '@/lib/i18n/clients-ar';
import {
  CLIENT_TRIP_STATUS_FILTERS,
  isClientTripStatusFilter,
  listTripRequestsForClient,
  type ClientTripStatusFilter,
} from '@/lib/clients/queries/me-requests';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.meRequestsTitle,
  robots: { index: false, follow: false },
};

const FILTER_LABEL: Record<ClientTripStatusFilter, string> = {
  all: clientsAr.meRequestsFilterAll,
  pending: clientsAr.tripStatusPending,
  distributed: clientsAr.tripStatusDistributed,
  offered: clientsAr.tripStatusOffered,
  booked: clientsAr.tripStatusBooked,
  cancelled: clientsAr.tripStatusCancelled,
};

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function ClientMeRequestsPage({
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();

  const { status } = await searchParams;
  const session = await requireClientSession();

  const filter: ClientTripStatusFilter = isClientTripStatusFilter(status)
    ? status
    : 'all';

  const rows = await listTripRequestsForClient(session.client_id, filter);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {clientsAr.meRequestsTitle}
          </h1>
        </div>
        <Link
          href="/me/charter"
          className="font-ar inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/25"
        >
          {clientsAr.meRequestsNewCta}
        </Link>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="trip status filter">
        {CLIENT_TRIP_STATUS_FILTERS.map((value) => {
          const active = value === filter;
          const href = value === 'all' ? '/me/requests' : `/me/requests?status=${value}`;
          return (
            <Link
              key={value}
              href={href}
              className={`font-ar rounded-full border px-3 py-1 text-xs transition-colors ${
                active
                  ? 'border-gold/60 bg-gold/20 text-gold-light'
                  : 'border-border bg-navy-secondary/40 text-ink-muted hover:border-gold/40 hover:text-gold-light'
              }`}
            >
              {FILTER_LABEL[value]}
            </Link>
          );
        })}
      </nav>

      <RequestsTable rows={rows} />
    </section>
  );
}
