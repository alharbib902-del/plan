import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';

import { requireClientSession } from '@/lib/clients/auth';
import { getMyShieldSubscription } from '@/lib/medevac/queries/me-shield';
import type { CoveredMember } from '@/lib/medevac/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفاصيل اشتراك Aeris Shield',
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'بانتظار الدفع',
  active: 'نشط',
  expired: 'منتهي',
  cancelled: 'ملغي',
  suspended: 'موقوف',
};

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

interface PageProps {
  params: { id: string };
}

export default async function ShieldDetailPage({ params }: PageProps) {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const session = await requireClientSession();
  if (!session) redirect(`/login?next=/me/medevac/shield/${params.id}`);

  const sub = await getMyShieldSubscription(session.client_id, params.id);
  if (!sub) notFound();

  const remaining =
    sub.covered_events_at_signup === -1
      ? '∞'
      : sub.covered_events_at_signup - sub.used_events;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/me/medevac"
          className="font-ar text-xs text-ink-muted hover:text-ink-secondary"
        >
          ← القائمة
        </Link>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          تفاصيل اشتراك Aeris Shield
        </h1>
        <p dir="ltr" className="font-mono text-sm text-gold-light">
          {sub.subscription_number}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="حالة الاشتراك">
          <Row
            label="الحالة"
            value={STATUS_LABELS[sub.status] ?? sub.status}
          />
          <Row label="الخطة" value={sub.plan} />
          <Row
            label="الرسم السنوي"
            value={
              <span dir="ltr">
                {Number.parseFloat(sub.annual_fee_at_signup_sar).toLocaleString(
                  'en-US'
                )}{' '}
                ريال
              </span>
            }
          />
        </Card>

        <Card title="التواريخ">
          <Row label="تاريخ البدء" value={fmt(sub.start_date)} />
          <Row label="تاريخ الانتهاء" value={fmt(sub.end_date)} />
          {sub.next_renewal_due && (
            <Row
              label="موعد التجديد"
              value={fmt(sub.next_renewal_due)}
            />
          )}
        </Card>

        <Card title="الأحداث المغطاة">
          <Row
            label="مستوى الخدمة"
            value={<span dir="ltr">{sub.service_level_at_signup}</span>}
          />
          <Row
            label="إعادة عبر الحدود"
            value={sub.includes_repatriation_at_signup ? 'نعم' : 'لا'}
          />
          <Row
            label="الإجمالي السنوي"
            value={
              <span dir="ltr">
                {sub.covered_events_at_signup === -1
                  ? '∞'
                  : sub.covered_events_at_signup}
              </span>
            }
          />
          <Row
            label="المستخدم"
            value={<span dir="ltr">{sub.used_events}</span>}
          />
          <Row
            label="المتبقي"
            value={<span dir="ltr">{remaining}</span>}
          />
        </Card>

        <Card title="الأعضاء المُغطَّوْن">
          {sub.covered_members.length === 0 ? (
            <p className="font-ar text-sm text-ink-muted">
              لا يوجد أعضاء مسجلون.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {sub.covered_members.map((m: CoveredMember, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="font-ar text-ink-primary">{m.name}</span>
                  <span className="font-ar text-xs text-ink-muted">
                    {m.relationship} · <span dir="ltr">{m.dob}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/30 p-5">
      <h2 className="font-ar mb-3 text-sm text-ink-secondary">{title}</h2>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="font-ar text-ink-muted">{label}</dt>
      <dd className="font-ar text-ink-primary">{value}</dd>
    </div>
  );
}
