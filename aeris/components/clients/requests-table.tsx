import Link from 'next/link';

import { clientsAr } from '@/lib/i18n/clients-ar';
import type { TripRequestRow } from '@/types/database';
import { TripStatusChip, type TripStatus } from './status-chip';

/**
 * Phase 9 PR 3 — `/me/requests` list table.
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

function routeSummary(row: TripRequestRow): string {
  const dep = row.departure_airport ?? '—';
  const arr = row.arrival_airport ?? '—';
  return `${dep} → ${arr}`;
}

export function RequestsTable({ rows }: { rows: TripRequestRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-navy-card/40 p-8 text-center">
        <p className="font-ar text-sm text-ink-muted">
          {clientsAr.meRequestsEmpty}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="font-ar w-full text-right text-sm">
        <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
          <tr>
            <Th>{clientsAr.meRequestsTableNumber}</Th>
            <Th>{clientsAr.meRequestsTableRoute}</Th>
            <Th>{clientsAr.meRequestsTableDeparture}</Th>
            <Th>{clientsAr.meRequestsTablePassengers}</Th>
            <Th>{clientsAr.meRequestsTableStatus}</Th>
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
                  {row.request_number}
                </span>
              </Td>
              <Td>
                <span dir="ltr">{routeSummary(row)}</span>
              </Td>
              <Td>{formatDateTimeAr(row.departure_date)}</Td>
              <Td>{row.passengers_count}</Td>
              <Td>
                <TripStatusChip status={row.status as TripStatus} />
              </Td>
              <Td>
                <Link
                  href={`/me/requests/${row.id}`}
                  className="text-gold-light hover:text-gold"
                >
                  {clientsAr.meRequestsViewDetails}
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
