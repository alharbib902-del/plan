import 'server-only';

import type { Metadata } from 'next';

import { requireAdminSession } from '@/lib/admin/auth';
import {
  getAnalyticsSummary,
  type AnalyticsOperator,
  type AnalyticsRoute,
} from '@/lib/admin/analytics';
import { analyticsAr } from '@/lib/i18n/analytics-ar';
import { formatSAR } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: analyticsAr.metaTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

const SOURCE_LABEL: Record<string, string> = {
  charter: analyticsAr.sourceCharter,
  empty_leg: analyticsAr.sourceEmptyLeg,
  cargo: analyticsAr.sourceCargo,
  medevac: analyticsAr.sourceMedevac,
};

const STATUS_LABEL: Record<string, string> = {
  pending: analyticsAr.statusPending,
  distributed: analyticsAr.statusDistributed,
  offered: analyticsAr.statusOffered,
  booked: analyticsAr.statusBooked,
  cancelled: analyticsAr.statusCancelled,
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Calendar +1 day on a date-only value (UTC arithmetic is DST-safe for a
// pure day increment). Used to build the half-open upper bound.
function nextYmd(s: string): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function validYmd(s?: string): s is string {
  return (
    !!s &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  );
}

function formatInt(n: number): string {
  try {
    return new Intl.NumberFormat('en-US').format(n);
  } catch {
    return String(n);
  }
}

function formatDateAr(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function errorMessage(error: string): string {
  if (error === 'invalid_range') return analyticsAr.errorInvalidRange;
  if (error === 'range_too_large') return analyticsAr.errorRangeTooLarge;
  return analyticsAr.errorGeneric;
}

function labeledRows(
  record: Record<string, number>,
  labels: Record<string, string>
): { label: string; count: number }[] {
  return Object.entries(record)
    .map(([key, count]) => ({ label: labels[key] ?? key, count }))
    .sort((a, b) => b.count - a.count);
}

export default async function AdminAnalyticsPage({ searchParams }: PageProps) {
  await requireAdminSession();

  const { from, to } = await searchParams;

  // Custom range only when BOTH bounds are valid; otherwise the RPC
  // defaults to the last 30 days. The date inputs are interpreted as
  // Asia/Riyadh (+03:00) calendar days: `from` = start of the from-day,
  // `to` = start of the day AFTER the to-day (the RPC range is half-open
  // [from, to)), so the whole selected to-day is included — no UTC drift.
  let fromIso: string | null = null;
  let toIso: string | null = null;
  if (validYmd(from) && validYmd(to)) {
    fromIso = `${from}T00:00:00+03:00`;
    toIso = `${nextYmd(to)}T00:00:00+03:00`;
  }

  const summary = await getAnalyticsSummary(fromIso, toIso);

  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
  const fromInput = validYmd(from) ? from : ymd(monthAgo);
  const toInput = validYmd(to) ? to : ymd(today);

  return (
    <section dir="rtl" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
            {analyticsAr.heading}
          </h1>
          {summary.ok ? (
            <p className="font-ar mt-1 text-sm text-ink-muted">
              {analyticsAr.rangeSummary}:{' '}
              <span dir="ltr">
                {formatDateAr(`${fromInput}T00:00:00+03:00`)} –{' '}
                {formatDateAr(`${toInput}T00:00:00+03:00`)}
              </span>
            </p>
          ) : null}
        </div>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="font-ar flex flex-col gap-1 text-xs text-ink-muted">
            {analyticsAr.rangeFrom}
            <input
              type="date"
              name="from"
              defaultValue={fromInput}
              className="font-ar rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
            />
          </label>
          <label className="font-ar flex flex-col gap-1 text-xs text-ink-muted">
            {analyticsAr.rangeTo}
            <input
              type="date"
              name="to"
              defaultValue={toInput}
              className="font-ar rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="font-ar rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/25"
          >
            {analyticsAr.rangeApply}
          </button>
        </form>
      </header>

      <p className="font-ar text-xs text-ink-muted">{analyticsAr.rangeHint}</p>

      {!summary.ok ? (
        <p className="font-ar rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
          {errorMessage(summary.error)}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi
              label={analyticsAr.revenueLabel}
              value={formatSAR(summary.revenue.paid_total_sar)}
              accent
            />
            <Kpi
              label={analyticsAr.paidCountLabel}
              value={formatInt(summary.revenue.paid_count)}
            />
            <Kpi
              label={analyticsAr.bookingsLabel}
              value={formatInt(summary.bookings.total_count)}
            />
            <Kpi
              label={analyticsAr.cancelledLabel}
              value={formatInt(summary.bookings.cancelled_count)}
            />
            <Kpi
              label={analyticsAr.requestsLabel}
              value={formatInt(summary.requests.total_count)}
            />
            <Kpi
              label={analyticsAr.conversionLabel}
              value={`${summary.requests.conversion_pct}%`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CountTable
              heading={analyticsAr.bySourceHeading}
              keyHeader={analyticsAr.colType}
              rows={labeledRows(summary.bookings.by_source, SOURCE_LABEL)}
            />
            <CountTable
              heading={analyticsAr.byStatusHeading}
              keyHeader={analyticsAr.colStatus}
              rows={labeledRows(summary.requests.by_status, STATUS_LABEL)}
            />
          </div>

          <RoutesTable routes={summary.top_routes} />
          <OperatorsTable operators={summary.top_operators} />
        </>
      )}
    </section>
  );
}

function Kpi({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-4">
      <div className="font-ar text-xs text-ink-muted">{label}</div>
      <div
        className={`font-ar mt-1 text-2xl ${accent ? 'text-gold-light' : 'text-ink-primary'}`}
      >
        {value}
      </div>
    </div>
  );
}

function SectionCard({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-ar text-lg text-ink-primary">{heading}</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-navy-card/40">
        {children}
      </div>
    </section>
  );
}

function CountTable({
  heading,
  keyHeader,
  rows,
}: {
  heading: string;
  keyHeader: string;
  rows: { label: string; count: number }[];
}) {
  return (
    <SectionCard heading={heading}>
      {rows.length === 0 ? (
        <p className="font-ar p-6 text-sm text-ink-muted">{analyticsAr.noData}</p>
      ) : (
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="border-b border-border">
              <Th>{keyHeader}</Th>
              <Th>{analyticsAr.colCount}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.label}
                className="border-b border-border/60 last:border-b-0"
              >
                <Td>{r.label}</Td>
                <Td>{formatInt(r.count)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function RoutesTable({ routes }: { routes: AnalyticsRoute[] }) {
  return (
    <SectionCard heading={analyticsAr.topRoutesHeading}>
      {routes.length === 0 ? (
        <p className="font-ar p-6 text-sm text-ink-muted">{analyticsAr.noData}</p>
      ) : (
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="border-b border-border">
              <Th>{analyticsAr.colRoute}</Th>
              <Th>{analyticsAr.colCount}</Th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr
                key={`${r.departure}:${r.arrival}`}
                className="border-b border-border/60 last:border-b-0"
              >
                <Td>
                  <span dir="ltr">
                    {r.departure} → {r.arrival}
                  </span>
                </Td>
                <Td>{formatInt(r.count)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function OperatorsTable({ operators }: { operators: AnalyticsOperator[] }) {
  return (
    <SectionCard heading={analyticsAr.topOperatorsHeading}>
      {operators.length === 0 ? (
        <p className="font-ar p-6 text-sm text-ink-muted">{analyticsAr.noData}</p>
      ) : (
        <table className="w-full border-collapse text-start">
          <thead>
            <tr className="border-b border-border">
              <Th>{analyticsAr.colOperator}</Th>
              <Th>{analyticsAr.colRevenue}</Th>
              <Th>{analyticsAr.colPaidCount}</Th>
            </tr>
          </thead>
          <tbody>
            {operators.map((o, i) => (
              <tr
                key={`${o.company_name}:${i}`}
                className="border-b border-border/60 last:border-b-0"
              >
                <Td>{o.company_name}</Td>
                <Td>{formatSAR(o.paid_total_sar)}</Td>
                <Td>{formatInt(o.paid_count)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="font-ar p-3 text-xs font-normal text-ink-muted">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="font-ar p-3 text-sm text-ink-primary">{children}</td>;
}
