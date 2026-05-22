import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';

import { requireClientSession } from '@/lib/clients/auth';
import { getMyMedevacRequestDetail } from '@/lib/medevac/queries/me-medevac';
import {
  loadAcceptCashbackContext,
  type AcceptCashbackContext,
} from '@/lib/privilege/accept-context';
import { medevacAr } from '@/lib/i18n/medevac-ar';
import {
  AcceptOfferButton,
  DeclineOfferButton,
  CancelRequestButton,
} from '@/components/medevac/medevac-detail-actions';
import type {
  MedevacRequestStatus,
  MedevacSeverity,
  MedevacOfferRow,
} from '@/lib/medevac/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفاصيل طلب الإخلاء الطبي',
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

function fmtDateTime(value: string | null): string {
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

function fmtSAR(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MyMedevacDetailPage({ params }: PageProps) {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const { id } = await params;
  const session = await requireClientSession();
  if (!session) redirect(`/login?next=/me/medevac/${id}`);

  const [detail, cashbackContext] = await Promise.all([
    getMyMedevacRequestDetail(session.client_id, id),
    loadAcceptCashbackContext(session.client_id),
  ]);
  if (!detail) notFound();

  const r = detail;
  const canCancel = ['pending', 'offers_received'].includes(r.status);

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
          تفاصيل طلب الإخلاء الطبي
        </h1>
        <p dir="ltr" className="font-mono text-sm text-gold-light">
          {r.medevac_request_number}
        </p>
        <p className="font-ar text-sm text-ink-secondary">
          {STATUS_LABELS[r.status] ?? r.status}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="المريض">
          <Row label="الاسم" value={r.patient_name_snapshot} />
          <Row
            label="العمر"
            value={r.patient_age_snapshot?.toString() ?? '—'}
          />
          <Row
            label="الحالة"
            value={SEVERITY_LABELS[r.condition_severity]}
          />
          <Row
            label="مستوى الخدمة"
            value={<span dir="ltr">{r.service_level}</span>}
          />
        </Card>

        <Card title="جهة الاتصال">
          <Row label="الاسم" value={r.contact_name_snapshot} />
          <Row
            label="الهاتف"
            value={<span dir="ltr">{r.contact_phone_snapshot}</span>}
          />
          {r.contact_email_snapshot && (
            <Row
              label="البريد"
              value={<span dir="ltr">{r.contact_email_snapshot}</span>}
            />
          )}
        </Card>

        <Card title="المسار">
          <Row label="الانطلاق" value={r.from_location_freeform} />
          {r.from_iata && (
            <Row label="IATA" value={<span dir="ltr">{r.from_iata}</span>} />
          )}
          <Row label="المستشفى" value={r.to_hospital_name} />
          {r.to_iata && (
            <Row label="IATA" value={<span dir="ltr">{r.to_iata}</span>} />
          )}
        </Card>

        <Card title="التسعير">
          <Row
            label="القيمة التقديرية"
            value={
              <span dir="ltr">{fmtSAR(r.estimated_value_sar)} ريال</span>
            }
          />
          <Row label="تاريخ الإنشاء" value={fmtDateTime(r.created_at)} />
          {r.is_covered && (
            <Row
              label="مغطى عبر Shield"
              value={<span className="text-emerald-300">نعم</span>}
            />
          )}
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="font-ar text-lg text-ink-primary">
          العروض ({detail.offers.length})
        </h2>
        {detail.offers.length === 0 ? (
          <p className="font-ar text-sm text-ink-muted">
            لا توجد عروض بعد. سيتم إشعارك عند ورود عروض من المشغلين.
          </p>
        ) : (
          <div className="space-y-3">
            {detail.offers.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                requestStatus={r.status}
                cashbackContext={cashbackContext}
              />
            ))}
          </div>
        )}
      </section>

      {canCancel && (
        <div className="pt-4">
          <CancelRequestButton requestId={r.id} />
        </div>
      )}
    </section>
  );
}

function OfferCard({
  offer,
  requestStatus,
  cashbackContext,
}: {
  offer: MedevacOfferRow;
  requestStatus: MedevacRequestStatus;
  cashbackContext: AcceptCashbackContext;
}) {
  const canAct =
    offer.status === 'pending' &&
    ['pending', 'offers_received'].includes(requestStatus);
  // total_price_sar is DECIMAL serialized as string by Supabase;
  // parse to number for the redemption input local D7 validation.
  const totalNumeric = Number.parseFloat(offer.total_price_sar);
  const offerTotalSar = Number.isFinite(totalNumeric) ? totalNumeric : 0;

  return (
    <article className="rounded-xl border border-border bg-navy-card/30 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="font-ar text-base text-ink-primary">
          {offer.operator_name_snapshot}
        </h3>
        <span className="font-ar text-xs text-ink-muted">
          {offer.status === 'pending' && 'بانتظار قرارك'}
          {offer.status === 'accepted' && 'مقبول'}
          {offer.status === 'declined' && 'مرفوض'}
          {offer.status === 'withdrawn' && 'مسحوب'}
          {offer.status === 'expired' && 'منتهي'}
        </span>
      </header>
      <dl className="space-y-1 text-sm">
        {offer.aircraft_snapshot && (
          <Row label="الطائرة" value={offer.aircraft_snapshot} />
        )}
        {offer.medical_team_snapshot && (
          <Row label="الطاقم الطبي" value={offer.medical_team_snapshot} />
        )}
        <Row
          label="السعر الإجمالي"
          value={
            <span dir="ltr">{fmtSAR(offer.total_price_sar)} ريال</span>
          }
        />
        <Row
          label="موعد الإقلاع المقترح"
          value={fmtDateTime(offer.proposed_pickup_at)}
        />
        <Row
          label="موعد الوصول المقترح"
          value={fmtDateTime(offer.proposed_arrival_at)}
        />
        {offer.operator_notes && (
          <Row label="ملاحظات المشغل" value={offer.operator_notes} />
        )}
      </dl>
      {canAct && (
        <footer className="mt-4 flex items-center justify-end gap-3">
          <DeclineOfferButton offerId={offer.id} />
          <AcceptOfferButton
            offerId={offer.id}
            offerTotalSar={offerTotalSar}
            privilegeEnabled={cashbackContext.enabled}
            cashbackBalanceSar={cashbackContext.cashback_balance_sar}
          />
        </footer>
      )}
    </article>
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
