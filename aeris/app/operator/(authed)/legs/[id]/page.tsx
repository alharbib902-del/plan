import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { requireOperatorSession } from '@/lib/operators/auth';
import { getOperatorLegById } from '@/lib/operators/portal-queries';
import { OperatorLegActions } from '@/components/operator/empty-legs/operator-leg-actions';
import { routeLabel } from '@/components/admin/empty-legs/formatters';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفاصيل الرحلة',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

const STATUS_LABELS: Record<string, string> = {
  available: 'متاحة',
  reserved: 'محجوزة',
  sold: 'مُباعة',
  expired: 'منتهية',
  cancelled: 'ملغاة',
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
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

export default async function OperatorLegDetailPage({ params }: PageProps) {
  const session = await requireOperatorSession();
  const leg = await getOperatorLegById(session.operator_id, params.id);
  if (!leg) notFound();

  return (
    <section className="space-y-6">
      <nav className="font-ar flex items-center gap-2 text-sm text-ink-muted">
        <Link href="/operator/legs" className="hover:text-gold-light">
          {operatorsAr.portal.nav.legs}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
        <span className="text-ink-secondary">{leg.leg_number}</span>
      </nav>

      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {routeLabel(
            leg.departure_airport,
            leg.departure_airport_freeform_snapshot
          )}{' '}
          →{' '}
          {routeLabel(
            leg.arrival_airport,
            leg.arrival_airport_freeform_snapshot
          )}
        </h1>
        <p className="mt-1 font-mono text-xs text-gold-light">{leg.leg_number}</p>
      </header>

      <section className="grid gap-3 rounded-xl border border-border bg-navy-card/40 p-5 md:grid-cols-3">
        <Field label="الحالة" value={STATUS_LABELS[leg.status] ?? leg.status} />
        <Field label="السعر الأصلي" value={Number(leg.original_price).toLocaleString('en-US')} />
        <Field label="السعر الحالي" value={Number(leg.current_price).toLocaleString('en-US')} />
        <Field label="المغادرة (من)" value={formatDateTime(leg.departure_window_start)} />
        <Field label="المغادرة (إلى)" value={formatDateTime(leg.departure_window_end)} />
        <Field label="عدد الركاب الأقصى" value={String(leg.max_passengers)} />
      </section>

      {leg.status === 'available' ? (
        <OperatorLegActions
          mode="session"
          legId={leg.id}
          currentPrice={Number(leg.current_price)}
          floorPrice={
            leg.original_price && leg.auction_floor_discount_pct
              ? Number(leg.original_price) *
                (1 - Number(leg.auction_floor_discount_pct) / 100)
              : null
          }
          originalPrice={Number(leg.original_price)}
        />
      ) : null}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-ar text-xs text-ink-muted">{label}</p>
      <p className="font-ar text-sm text-ink-primary">{value}</p>
    </div>
  );
}
