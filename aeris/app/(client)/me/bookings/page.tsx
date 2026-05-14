import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BookingsTable } from '@/components/clients/bookings-table';
import { requireClientSession } from '@/lib/clients/auth';
import { listBookingsForClient } from '@/lib/clients/queries/me-bookings';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.meBookingsTitle,
  robots: { index: false, follow: false },
};

export default async function ClientMeBookingsPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();

  const session = await requireClientSession();
  const rows = await listBookingsForClient(session.client_id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.meBookingsTitle}
        </h1>
      </header>
      <BookingsTable rows={rows} />
    </section>
  );
}
