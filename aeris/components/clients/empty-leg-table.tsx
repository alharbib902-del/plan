import Link from 'next/link';

import { clientsAr } from '@/lib/i18n/clients-ar';
import type { EmptyLegRow } from '@/lib/empty-legs/types';
import type { MatchedEmptyLegEntry } from '@/lib/clients/queries/me-empty-legs';

/**
 * Phase 10 PR 2 — empty-leg list table for the /me/empty-legs
 * tabbed page.
 *
 * Renders both shapes (browse-all + matches) via two named
 * exports:
 *   - EmptyLegBrowseTable: pure EmptyLegRow[] (sorted by current_price)
 *   - EmptyLegMatchesTable: MatchedEmptyLegEntry[] (sorted by sent_at)
 *
 * Server-rendered. Each row links to /me/empty-legs/<leg_number>.
 */

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

function legRouteLabel(leg: EmptyLegRow): string {
  const dep =
    leg.departure_airport ?? leg.departure_airport_freeform_snapshot ?? '—';
  const arr =
    leg.arrival_airport ?? leg.arrival_airport_freeform_snapshot ?? '—';
  return `${dep} → ${arr}`;
}

interface BrowseProps {
  legs: EmptyLegRow[];
}

export function EmptyLegBrowseTable({ legs }: BrowseProps) {
  if (legs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
        <p className="font-ar text-sm text-ink-muted">
          {clientsAr.emptyLegsEmptyBrowseAll}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="font-ar w-full text-right text-sm">
        <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
          <tr>
            <Th>{clientsAr.emptyLegsTableNumber}</Th>
            <Th>{clientsAr.emptyLegsCardRoute}</Th>
            <Th>{clientsAr.emptyLegsCardDeparture}</Th>
            <Th>{clientsAr.emptyLegsCardPrice}</Th>
            <Th>{clientsAr.emptyLegsCardDiscount}</Th>
            <Th>{clientsAr.meRequestsTableActions}</Th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg) => (
            <tr
              key={leg.id}
              className="border-t border-border/60 hover:bg-navy-secondary/40"
            >
              <Td>
                <span dir="ltr" className="text-ink-primary">
                  {leg.leg_number}
                </span>
              </Td>
              <Td>
                <span dir="ltr">{legRouteLabel(leg)}</span>
              </Td>
              <Td>{formatDateAr(leg.departure_window_start)}</Td>
              <Td>
                {formatSAR(
                  leg.current_price as unknown as number | string | null
                )}
              </Td>
              <Td>
                <span className="text-gold-light">
                  {leg.current_discount_pct
                    ? `${leg.current_discount_pct}%`
                    : '—'}
                </span>
              </Td>
              <Td>
                <Link
                  href={`/me/empty-legs/${leg.leg_number}`}
                  className="text-gold-light hover:text-gold"
                >
                  {clientsAr.emptyLegsViewDetails}
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MatchesProps {
  entries: MatchedEmptyLegEntry[];
}

export function EmptyLegMatchesTable({ entries }: MatchesProps) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-10 text-center">
        <p className="font-ar text-sm text-ink-muted">
          {clientsAr.emptyLegsEmptyMatches}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="font-ar w-full text-right text-sm">
        <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
          <tr>
            <Th>{clientsAr.emptyLegsTableNumber}</Th>
            <Th>{clientsAr.emptyLegsCardRoute}</Th>
            <Th>{clientsAr.emptyLegsTableMatchedAt}</Th>
            <Th>{clientsAr.emptyLegsCardPrice}</Th>
            <Th>{clientsAr.emptyLegsCardDiscount}</Th>
            <Th>{clientsAr.meRequestsTableActions}</Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.notification_id}
              className="border-t border-border/60 hover:bg-navy-secondary/40"
            >
              <Td>
                <span dir="ltr" className="text-ink-primary">
                  {entry.leg.leg_number}
                </span>
              </Td>
              <Td>
                <span dir="ltr">{legRouteLabel(entry.leg)}</span>
              </Td>
              <Td>{formatDateAr(entry.notification_sent_at)}</Td>
              <Td>
                {formatSAR(
                  entry.leg.current_price as unknown as
                    | number
                    | string
                    | null
                )}
              </Td>
              <Td>
                <span className="text-gold-light">
                  {entry.leg.current_discount_pct
                    ? `${entry.leg.current_discount_pct}%`
                    : '—'}
                </span>
              </Td>
              <Td>
                <Link
                  href={`/me/empty-legs/${entry.leg.leg_number}`}
                  className="text-gold-light hover:text-gold"
                >
                  {clientsAr.emptyLegsViewDetails}
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
