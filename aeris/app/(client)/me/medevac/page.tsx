import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';

import { requireClientSession } from '@/lib/clients/auth';
import { listMyMedevacRequests } from '@/lib/medevac/queries/me-medevac';
import { listMyShieldSubscriptions } from '@/lib/medevac/queries/me-shield';
import { medevacAr } from '@/lib/i18n/medevac-ar';
import type {
  MedevacRequestRow,
  MedevacSeverity,
  MedevacRequestStatus,
} from '@/lib/medevac/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'طلبات الإخلاء الطبي',
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

function fmtDate(value: string | null): string {
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

function routeLabel(row: MedevacRequestRow): string {
  const dep = row.from_iata ?? row.from_location_freeform ?? '—';
  const arr = row.to_iata ?? row.to_hospital_name ?? '—';
  return `${dep} → ${arr}`;
}

function severityClass(s: MedevacSeverity): string {
  switch (s) {
    case 'critical':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'moderate':
      return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
    default:
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }
}

export default async function MyMedevacPage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const session = await requireClientSession();
  if (!session) redirect('/login?next=/me/medevac');

  const [requests, subscriptions] = await Promise.all([
    listMyMedevacRequests(session.client_id),
    listMyShieldSubscriptions(session.client_id),
  ]);

  const activeSub = subscriptions.find((s) => s.status === 'active');

  return (
    <section className="space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          طلبات الإخلاء الطبي
        </h1>
        <div className="flex gap-2">
          <Link
            href="/me/medevac/new"
            className="font-ar rounded-lg bg-gold px-4 py-2 text-sm font-medium text-navy hover:opacity-90"
          >
            طلب جديد
          </Link>
          {!activeSub && (
            <Link
              href="/me/medevac/shield/subscribe"
              className="font-ar rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
            >
              اشترك في Aeris Shield
            </Link>
          )}
        </div>
      </header>

      {activeSub && (
        <div
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-200"
          dir="rtl"
        >
          <p className="font-ar">
            اشتراك Aeris Shield نشط ·{' '}
            <Link
              href={`/me/medevac/shield/${activeSub.id}`}
              className="underline hover:text-emerald-100"
            >
              {activeSub.subscription_number}
            </Link>{' '}
            · الأحداث المتبقية:{' '}
            <span dir="ltr">
              {activeSub.covered_events_at_signup === -1
                ? '∞'
                : activeSub.covered_events_at_signup -
                  activeSub.used_events}
            </span>
          </p>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            لا توجد طلبات إخلاء طبي بعد.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="font-ar w-full text-right text-sm">
            <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
              <tr>
                <Th>رقم الطلب</Th>
                <Th>الحالة</Th>
                <Th>المستوى</Th>
                <Th>المسار</Th>
                <Th>الحالة</Th>
                <Th>التاريخ</Th>
                <Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => (
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
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${severityClass(
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
                  <Td>{fmtDate(row.created_at)}</Td>
                  <Td>
                    <Link
                      href={`/me/medevac/${row.id}`}
                      className="text-gold-light hover:text-gold"
                    >
                      تفاصيل
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
