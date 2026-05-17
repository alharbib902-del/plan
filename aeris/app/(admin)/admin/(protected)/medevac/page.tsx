import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { listAdminMedevacRequests } from '@/lib/medevac/admin-pii';
import { medevacAr } from '@/lib/i18n/medevac-ar';
import type {
  MedevacRequestRedactedRow,
  MedevacSeverity,
  MedevacRequestStatus,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 1 — admin /admin/medevac queue.
 *
 * PII-FREE list view per D8 (Round 10 P1 #1). Renders MEV +
 * severity + service_level + route + status + value only —
 * patient_name_snapshot and patient_age_snapshot are NEVER
 * loaded here. The audited PII surface is /admin/medevac/[id].
 *
 * Sorted by created_at DESC (newest first); future polish may
 * switch to dispatched_at urgency proxy once PR 3 lands.
 *
 * Gated behind ENABLE_MEDEVAC env flag (404 when off).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: medevacAr.adminQueueTitle,
  robots: { index: false, follow: false },
};

const SEVERITY_LABELS: Record<MedevacSeverity, string> = {
  stable: medevacAr.severityStable,
  moderate: medevacAr.severityModerate,
  critical: medevacAr.severityCritical,
};

const STATUS_LABELS: Record<MedevacRequestStatus, string> = {
  pending: 'بانتظار العروض',
  offers_received: 'عروض مستلمة',
  accepted: 'مقبول',
  covered: 'مغطى (Shield)',
  cancelled: 'ملغي',
  expired: 'منتهي',
};

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

function formatSAR(value: string | null): string {
  if (value === null || value === undefined) return '—';
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    numeric
  );
}

function routeLabel(row: MedevacRequestRedactedRow): string {
  const dep = row.from_iata ?? row.from_location_freeform ?? '—';
  const arr = row.to_iata ?? row.to_hospital_name ?? '—';
  return `${dep} → ${arr}`;
}

function severityChipClass(severity: MedevacSeverity): string {
  switch (severity) {
    case 'critical':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'moderate':
      return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
    case 'stable':
    default:
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }
}

export default async function AdminMedevacQueuePage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const rows = await listAdminMedevacRequests();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {medevacAr.adminQueueTitle}
        </h1>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            {medevacAr.adminQueueEmpty}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="font-ar w-full text-right text-sm">
            <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
              <tr>
                <Th>{medevacAr.adminColMev}</Th>
                <Th>{medevacAr.adminColSeverity}</Th>
                <Th>{medevacAr.adminColService}</Th>
                <Th>{medevacAr.adminColRoute}</Th>
                <Th>{medevacAr.adminColStatus}</Th>
                <Th>{medevacAr.adminColValue}</Th>
                <Th>{medevacAr.adminColCreated}</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-border/60 hover:bg-navy-secondary/40"
                >
                  <Td>
                    <span dir="ltr" className="font-mono text-ink-primary">
                      {row.medevac_request_number}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${severityChipClass(
                        row.condition_severity
                      )}`}
                    >
                      {SEVERITY_LABELS[row.condition_severity]}
                    </span>
                  </Td>
                  <Td>
                    <span dir="ltr">{row.service_level}</span>
                  </Td>
                  <Td>
                    <span dir="ltr">{routeLabel(row)}</span>
                  </Td>
                  <Td>{STATUS_LABELS[row.status] ?? row.status}</Td>
                  <Td>
                    <span dir="ltr">{formatSAR(row.estimated_value_sar)}</span>
                  </Td>
                  <Td>{formatDateAr(row.created_at)}</Td>
                  <Td>
                    <Link
                      href={`/admin/medevac/${row.id}`}
                      className="text-gold-light hover:text-gold"
                    >
                      {medevacAr.adminViewDetail}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-middle">{children}</td>;
}
