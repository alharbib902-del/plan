import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

import { formatSARLabel } from '@/components/clients/offer-format';
import {
  SOURCE_LABEL_AR,
  formatBookingRoute,
  formatRiyadhDateTime,
} from '@/lib/admin/bookings/constants';
import type { AdminBookingListRow } from '@/lib/admin/bookings/queries';
import { formatPhone } from '@/lib/utils/format';

import { FlightStatusBadge, PaymentStatusBadge } from './booking-status-badges';

const TH =
  'font-ar px-4 py-3 text-start text-xs font-medium uppercase tracking-tagged text-ink-muted';

export function BookingTable({ rows }: { rows: AdminBookingListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
        <p className="font-ar text-sm text-ink-muted">
          لا توجد حجوزات بهذه التصفية.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: table */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-navy-card/40 lg:block">
        <table className="w-full">
          <thead className="border-b border-border bg-navy-secondary/60">
            <tr>
              <th scope="col" className={TH}>رقم الحجز</th>
              <th scope="col" className={TH}>العميل</th>
              <th scope="col" className={TH}>المسار</th>
              <th scope="col" className={TH}>المغادرة</th>
              <th scope="col" className={TH}>الإجمالي</th>
              <th scope="col" className={TH}>الدفع</th>
              <th scope="col" className={TH}>الرحلة</th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">فتح</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-border/60 transition-colors hover:bg-navy-secondary/40"
              >
                <td className="px-4 py-4">
                  <div className="font-mono text-sm text-gold-light" dir="ltr">
                    {row.booking_number}
                  </div>
                  <div className="font-ar mt-1 text-xs text-ink-muted">
                    {SOURCE_LABEL_AR[row.source_discriminator] ??
                      row.source_discriminator}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="font-ar text-sm text-ink">
                    {row.client_name ?? 'بدون اسم'}
                  </div>
                  {row.client_phone ? (
                    <div className="font-ar mt-1 text-xs text-ink-muted" dir="ltr">
                      {formatPhone(row.client_phone)}
                    </div>
                  ) : null}
                </td>
                <td className="font-ar px-4 py-4 text-sm text-ink">
                  <span dir="ltr">{formatBookingRoute(row)}</span>
                </td>
                <td className="font-ar px-4 py-4 text-sm text-ink-secondary">
                  {formatRiyadhDateTime(row.departure_scheduled)}
                </td>
                <td className="font-ar px-4 py-4 text-sm text-ink">
                  {formatSARLabel(row.total_amount)}
                </td>
                <td className="px-4 py-4">
                  <PaymentStatusBadge status={row.payment_status} />
                </td>
                <td className="px-4 py-4">
                  <FlightStatusBadge status={row.flight_status} />
                </td>
                <td className="px-4 py-4 text-end">
                  <Link
                    href={`/admin/bookings/${row.id}`}
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
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/admin/bookings/${row.id}`}
            className="block rounded-xl border border-border bg-navy-card/40 p-4 transition-colors hover:border-gold/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-sm text-gold-light" dir="ltr">
                  {row.booking_number}
                </div>
                <div className="font-ar mt-1 truncate text-base text-ink">
                  {row.client_name ?? 'بدون اسم'}
                </div>
                {row.client_phone ? (
                  <div className="font-ar mt-0.5 text-xs text-ink-muted" dir="ltr">
                    {formatPhone(row.client_phone)}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <PaymentStatusBadge status={row.payment_status} />
                <FlightStatusBadge status={row.flight_status} />
              </div>
            </div>
            <div className="mt-3 border-t border-border/60 pt-3">
              <div className="font-ar text-sm text-ink-secondary">
                <span dir="ltr">{formatBookingRoute(row)}</span>
              </div>
              <div className="font-ar mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>
                  {SOURCE_LABEL_AR[row.source_discriminator] ??
                    row.source_discriminator}
                </span>
                <span>· {formatRiyadhDateTime(row.departure_scheduled)}</span>
              </div>
            </div>
            <div className="font-ar mt-3 text-sm text-ink">
              {formatSARLabel(row.total_amount)}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
