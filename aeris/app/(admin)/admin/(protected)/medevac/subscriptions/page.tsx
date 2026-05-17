import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { listAdminMedevacSubscriptions } from '@/lib/medevac/queries/admin-subscriptions';
import type { MedevacSubscriptionRow } from '@/lib/medevac/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'اشتراكات Aeris Shield',
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'بانتظار الدفع',
  active: 'نشط',
  expired: 'منتهي',
  cancelled: 'ملغي',
  suspended: 'موقوف',
};

function statusClass(s: string): string {
  switch (s) {
    case 'active':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'pending_payment':
      return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
    case 'expired':
    case 'cancelled':
    case 'suspended':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default:
      return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
  }
}

function fmt(value: string | null): string {
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

export default async function AdminMedevacSubscriptionsPage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const subs = await listAdminMedevacSubscriptions();
  const pending = subs.filter((s) => s.status === 'pending_payment');
  const active = subs.filter((s) => s.status === 'active');
  const other = subs.filter(
    (s) => s.status !== 'pending_payment' && s.status !== 'active'
  );

  return (
    <section className="space-y-8">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          اشتراكات Aeris Shield
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          الاشتراكات في حالة &quot;بانتظار الدفع&quot; تحتاج تفعيل يدوي بعد
          استلام الدفع.
        </p>
      </header>

      <Section title={`بانتظار التفعيل (${pending.length})`} rows={pending} />
      <Section title={`نشطة (${active.length})`} rows={active} />
      {other.length > 0 && (
        <Section title={`أخرى (${other.length})`} rows={other} />
      )}
    </section>
  );

  function Section({
    title,
    rows,
  }: {
    title: string;
    rows: MedevacSubscriptionRow[];
  }) {
    if (rows.length === 0) return null;
    return (
      <div className="space-y-3">
        <h2 className="font-ar text-lg text-ink-secondary">{title}</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="font-ar w-full text-right text-sm">
            <thead className="bg-navy-secondary/60 text-xs text-ink-muted">
              <tr>
                <Th>رقم الاشتراك</Th>
                <Th>الخطة</Th>
                <Th>الحالة</Th>
                <Th>الأحداث</Th>
                <Th>البدء</Th>
                <Th>الانتهاء</Th>
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
                      {row.subscription_number}
                    </span>
                  </Td>
                  <Td>{row.plan}</Td>
                  <Td>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusClass(
                        row.status
                      )}`}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </Td>
                  <Td>
                    <span dir="ltr">
                      {row.used_events}/
                      {row.covered_events_at_signup === -1
                        ? '∞'
                        : row.covered_events_at_signup}
                    </span>
                  </Td>
                  <Td>{fmt(row.start_date)}</Td>
                  <Td>{fmt(row.end_date)}</Td>
                  <Td>
                    {row.status === 'pending_payment' && (
                      <Link
                        href={`/admin/medevac/subscriptions/${row.id}/activate`}
                        className="text-gold-light hover:text-gold"
                      >
                        تفعيل
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-3 align-middle">{children}</td>;
}
