import Link from 'next/link';

import { clientsAr } from '@/lib/i18n/clients-ar';
import type { BookingRow } from '@/types/database';

/**
 * Phase 9 PR 3 — `/me/bookings` list table.
 * Server-rendered (no client interactivity beyond Next links).
 */

function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
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
  const numeric =
    typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return String(numeric);
  }
}

function bookingRouteSummary(row: BookingRow): string {
  const dep = row.route_origin_iata ?? row.route_origin_freeform_snapshot ?? '—';
  const arr =
    row.route_destination_iata ??
    row.route_destination_freeform_snapshot ??
    '—';
  return `${dep} → ${arr}`;
}

export function BookingsTable({ rows }: { rows: BookingRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-navy-card/40 p-8 text-center">
        <p className="font-ar text-sm text-ink-muted">
          {clientsAr.meBookingsEmpty}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="font-ar w-full text-right text-sm">
        <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
          <tr>
            <Th>{clientsAr.meBookingsTableNumber}</Th>
            <Th>{clientsAr.meBookingsTableRoute}</Th>
            <Th>{clientsAr.meBookingsTableDeparture}</Th>
            <Th>{clientsAr.meBookingsTableOperator}</Th>
            <Th>{clientsAr.meBookingsTableTotal}</Th>
            <Th>{clientsAr.meRequestsTableActions}</Th>
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
                  {row.booking_number}
                </span>
              </Td>
              <Td>
                <span dir="ltr">{bookingRouteSummary(row)}</span>
              </Td>
              <Td>{formatDateTimeAr(row.departure_scheduled)}</Td>
              <Td>
                <span className="text-ink-primary">
                  {row.operator_name_snapshot ?? '—'}
                </span>
              </Td>
              <Td>{formatSAR(row.total_amount as unknown as number | string | null)}</Td>
              <Td>
                <Link
                  href={`/me/bookings/${row.id}`}
                  className="text-gold-light hover:text-gold"
                >
                  {clientsAr.meBookingsViewDetails}
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-middle">{children}</td>;
}
