import type { Metadata } from 'next';
import { TripStatusFilter } from '@/components/admin/trip-status-filter';
import { TripTable } from '@/components/admin/trip-table';
import {
  countTripsByStatus,
  listTrips,
  TRIP_STATUSES,
} from '@/lib/supabase/queries/trips';
import type { TripRequestStatus } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'الرحلات',
  robots: { index: false, follow: false },
};

interface TripsPageProps {
  searchParams?: { status?: string };
}

function parseStatus(raw: string | undefined): TripRequestStatus | 'all' {
  if (!raw) return 'all';
  const lowered = raw.toLowerCase();
  if (lowered === 'all') return 'all';
  if ((TRIP_STATUSES as readonly string[]).includes(lowered)) {
    return lowered as TripRequestStatus;
  }
  return 'all';
}

export default async function AdminTripsPage({ searchParams }: TripsPageProps) {
  const status = parseStatus(searchParams?.status);
  const [trips, counts] = await Promise.all([
    listTrips({ status, limit: 200 }),
    countTripsByStatus(),
  ]);

  return (
    <section>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-ar text-2xl text-ink sm:text-3xl">طلبات الرحلات</h1>
          <p className="font-ar mt-1 text-sm text-ink-muted">
            الرحلات الناتجة عن تحويل الطلبات الواردة. أرسل للمشغّلين وراجع
            عروضهم من هنا.
          </p>
        </div>
      </div>

      <div className="mb-6">
        <TripStatusFilter current={status} counts={counts} />
      </div>

      <TripTable trips={trips} />
    </section>
  );
}
