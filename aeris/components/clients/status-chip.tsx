import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 9 PR 3 — shared trip-status chip used by the requests
 * table + the request detail header. Maps the SQL
 * `trip_request_status` enum to Arabic labels + the same
 * tone palette as the operator/admin surfaces (gold, blue,
 * emerald, slate, rose).
 */

export type TripStatus =
  | 'pending'
  | 'distributed'
  | 'offered'
  | 'booked'
  | 'cancelled';

const TONE: Record<TripStatus, string> = {
  pending: 'border-gold/40 bg-gold/10 text-gold-light',
  distributed: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  offered: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  booked: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  cancelled: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
};

const LABEL: Record<TripStatus, string> = {
  pending: clientsAr.tripStatusPending,
  distributed: clientsAr.tripStatusDistributed,
  offered: clientsAr.tripStatusOffered,
  booked: clientsAr.tripStatusBooked,
  cancelled: clientsAr.tripStatusCancelled,
};

export function TripStatusChip({ status }: { status: TripStatus }) {
  return (
    <span
      className={`font-ar inline-flex items-center rounded-full border px-3 py-1 text-xs ${TONE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
