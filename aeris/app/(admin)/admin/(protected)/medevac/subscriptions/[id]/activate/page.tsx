import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { getAdminMedevacSubscription } from '@/lib/medevac/queries/admin-subscriptions';
import { ActivateSubscriptionButton } from '@/components/admin/medevac/activate-subscription-button';
import type { CoveredMember } from '@/lib/medevac/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفعيل اشتراك Aeris Shield',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
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

export default async function ActivateSubPage({ params }: PageProps) {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const { id } = await params;
  const sub = await getAdminMedevacSubscription(id);
  if (!sub) notFound();

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <Link
          href="/admin/medevac/subscriptions"
          className="font-ar text-xs text-ink-muted hover:text-ink-secondary"
        >
          ← قائمة الاشتراكات
        </Link>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          تفعيل اشتراك Aeris Shield
        </h1>
        <p dir="ltr" className="font-mono text-sm text-gold-light">
          {sub.subscription_number}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="الاشتراك">
          <Row label="الخطة" value={sub.plan} />
          <Row
            label="الرسم"
            value={
              <span dir="ltr">
                {Number.parseFloat(
                  sub.annual_fee_at_signup_sar
                ).toLocaleString('en-US')}{' '}
                ريال
              </span>
            }
          />
          <Row
            label="مستوى الخدمة"
            value={<span dir="ltr">{sub.service_level_at_signup}</span>}
          />
          <Row
            label="إعادة عبر الحدود"
            value={sub.includes_repatriation_at_signup ? 'نعم' : 'لا'}
          />
          <Row
            label="الأحداث السنوية"
            value={
              <span dir="ltr">
                {sub.covered_events_at_signup === -1
                  ? '∞'
                  : sub.covered_events_at_signup}
              </span>
            }
          />
          <Row label="تاريخ الإنشاء" value={fmt(sub.created_at)} />
        </Card>

        <Card title="الأعضاء المُغطَّوْن">
          {sub.covered_members.length === 0 ? (
            <p className="font-ar text-sm text-ink-muted">
              لا يوجد أعضاء.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
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

      {sub.status === 'pending_payment' ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
          <p className="font-ar mb-4 text-sm text-amber-200">
            عند الضغط على &quot;تفعيل&quot; — يتم:
          </p>
          <ul className="font-ar mb-4 list-inside list-disc space-y-1 text-sm text-ink-secondary">
            <li>تغيير الحالة من &quot;بانتظار الدفع&quot; → &quot;نشط&quot;</li>
            <li>
              تعيين تاريخ البدء = اليوم · تاريخ الانتهاء = اليوم + سنة
            </li>
            <li>تعيين تاريخ التذكير بالتجديد قبل 30 يوم من الانتهاء</li>
            <li>تسجيل العملية في audit_logs (subscription_activated)</li>
          </ul>
          <ActivateSubscriptionButton subscriptionId={sub.id} />
        </div>
      ) : (
        <p className="font-ar rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-200">
          الاشتراك في حالة <strong>{sub.status}</strong> — لا حاجة لتفعيل.
        </p>
      )}
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
