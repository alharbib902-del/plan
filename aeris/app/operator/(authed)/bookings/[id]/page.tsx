import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { requireOperatorSession } from '@/lib/operators/auth';
import { getOperatorBookingById } from '@/lib/operators/portal-queries';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفاصيل الحجز',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default async function OperatorBookingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireOperatorSession();
  const booking = await getOperatorBookingById(session.operator_id, id);
  if (!booking) notFound();

  return (
    <section className="space-y-6">
      <nav className="font-ar flex items-center gap-2 text-sm text-ink-muted">
        <Link href="/operator/bookings" className="hover:text-gold-light">
          {operatorsAr.portal.bookings.title}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span className="font-mono text-xs text-ink-secondary">{booking.booking_number}</span>
      </nav>

      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {booking.customer_name ?? 'حجز'}
        </h1>
        <p className="mt-1 font-mono text-xs text-gold-light">{booking.booking_number}</p>
      </header>

      <section className="grid gap-3 rounded-xl border border-border bg-navy-card/40 p-5 md:grid-cols-2">
        <Field label="الحالة" value={booking.status} />
        <Field label="تاريخ الإنشاء" value={formatDateTime(booking.created_at)} />
        <Field label="رقم الجوّال" value={booking.customer_phone ?? '—'} dir="ltr" />
        <Field
          label="المبلغ الإجمالي"
          value={`${Number(booking.total_price_sar).toLocaleString('en-US')} ر.س`}
        />
      </section>

      <div className="rounded-xl border border-border bg-navy-card/30 p-5">
        <p className="font-ar text-sm text-ink-muted">
          هذه الصفحة للعرض فقط. لا تتوفّر إجراءات قبول / رفض من بوابة المشغّل (Decision §10).
        </p>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  dir,
}: {
  label: string;
  value: string;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <div>
      <p className="font-ar text-xs text-ink-muted">{label}</p>
      <p
        dir={dir}
        className="font-ar text-sm text-ink-primary"
      >
        {value}
      </p>
    </div>
  );
}
