import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { TripRequestRow } from '@/types/database';
import { TripStatusBadge } from './trip-status-badge';
import { formatPhone } from '@/lib/utils/format';

function formatDateAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDateTimeAr(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function routeOf(trip: TripRequestRow): string {
  const legs = trip.legs ?? [];
  if (legs.length === 0) return '—';
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (legs.length === 1) {
    return `${first.from} ← ${first.to}`;
  }
  return `${first.from} ← ${last.to}`;
}

export function TripTable({ trips }: { trips: TripRequestRow[] }) {
  if (trips.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
        <p className="font-ar text-sm text-ink-muted">
          لا توجد رحلات بهذه الحالة.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-navy-card/40 lg:block">
        <table className="w-full text-right">
          <thead className="border-b border-border bg-navy-secondary/60">
            <tr>
              <th
                scope="col"
                className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
              >
                الرقم
              </th>
              <th
                scope="col"
                className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
              >
                العميل
              </th>
              <th
                scope="col"
                className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
              >
                المسار
              </th>
              <th
                scope="col"
                className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
              >
                المغادرة
              </th>
              <th
                scope="col"
                className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
              >
                الحالة
              </th>
              <th
                scope="col"
                className="font-ar px-4 py-3 text-xs font-medium uppercase tracking-tagged text-ink-muted"
              >
                أنشئ في
              </th>
              <th scope="col" className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => (
              <tr
                key={trip.id}
                className="border-t border-border/60 transition-colors hover:bg-navy-secondary/40"
              >
                <td className="px-4 py-4 font-mono text-sm text-gold-light">
                  {trip.request_number}
                </td>
                <td className="px-4 py-4">
                  <div className="font-ar text-sm text-ink">
                    {trip.customer_name ?? '—'}
                  </div>
                  {trip.customer_phone ? (
                    <div
                      className="font-ar mt-1 text-xs text-ink-muted"
                      dir="ltr"
                    >
                      {formatPhone(trip.customer_phone)}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-4">
                  <div className="font-ar text-sm text-ink">{routeOf(trip)}</div>
                  <div className="font-ar mt-1 text-xs text-ink-muted">
                    {trip.passengers_count} ركاب
                  </div>
                </td>
                <td className="font-ar px-4 py-4 text-sm text-ink-secondary">
                  {formatDateAr(trip.departure_date)}
                </td>
                <td className="px-4 py-4">
                  <TripStatusBadge status={trip.status} />
                </td>
                <td className="font-ar px-4 py-4 text-xs text-ink-muted">
                  {formatDateTimeAr(trip.created_at)}
                </td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={`/admin/trips/${trip.id}`}
                    className="font-ar inline-flex items-center gap-1 text-sm text-gold-light transition-colors hover:text-gold"
                  >
                    فتح
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet: card stack */}
      <div className="grid gap-3 lg:hidden">
        {trips.map((trip) => (
          <Link
            key={trip.id}
            href={`/admin/trips/${trip.id}`}
            className="block rounded-xl border border-border bg-navy-card/40 p-4 transition-colors hover:border-gold/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-sm text-gold-light">
                  {trip.request_number}
                </div>
                <div className="font-ar mt-1 text-base text-ink">
                  {trip.customer_name ?? '—'}
                </div>
                {trip.customer_phone ? (
                  <div
                    className="font-ar mt-0.5 text-xs text-ink-muted"
                    dir="ltr"
                  >
                    {formatPhone(trip.customer_phone)}
                  </div>
                ) : null}
              </div>
              <TripStatusBadge status={trip.status} />
            </div>
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="font-ar text-sm text-ink-secondary">
                {routeOf(trip)}
              </div>
              <div className="font-ar mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>{trip.passengers_count} ركاب</span>
                <span>· {formatDateAr(trip.departure_date)}</span>
              </div>
            </div>
            <div className="font-ar mt-3 text-xs text-ink-muted">
              أنشئ في {formatDateTimeAr(trip.created_at)}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
