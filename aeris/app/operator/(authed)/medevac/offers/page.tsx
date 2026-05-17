import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireOperatorSession } from '@/lib/operators/auth';
import {
  listMyOperatorMedevacOffers,
  getBookedPatientNameForOffer,
} from '@/lib/medevac/queries/operator-list';
import type {
  MedevacOfferRow,
  MedevacOfferStatus,
} from '@/lib/medevac/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'عروضي للإخلاء الطبي',
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<MedevacOfferStatus, string> = {
  pending: 'بانتظار قرار العميل',
  accepted: 'مقبول',
  declined: 'مرفوض',
  withdrawn: 'مسحوب',
  expired: 'منتهي',
};

function statusClass(s: MedevacOfferStatus): string {
  switch (s) {
    case 'accepted':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'declined':
    case 'withdrawn':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'expired':
      return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30';
    case 'pending':
    default:
      return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
  }
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
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

export default async function OperatorMedevacOffersPage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  const session = await requireOperatorSession();
  const offers = await listMyOperatorMedevacOffers(session.operator_id);

  // D8 (c) — for accepted offers, fetch the patient name from
  // bookings.customer_name_snapshot (the post-acceptance fanout
  // that accept_medevac_offer wrote). Other statuses keep
  // patient-name redacted.
  const acceptedIds = offers
    .filter((o) => o.status === 'accepted')
    .map((o) => o.id);
  const patientNames = new Map<string, string>();
  await Promise.all(
    acceptedIds.map(async (id) => {
      const name = await getBookedPatientNameForOffer(id);
      if (name) patientNames.set(id, name);
    })
  );

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          عروضي للإخلاء الطبي
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          اسم المريض يظهر فقط على العروض المقبولة (D8).
        </p>
      </header>

      {offers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-12 text-center">
          <p className="font-ar text-sm text-ink-muted">
            لم تقدّم أي عرض بعد.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {offers.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              patientName={patientNames.get(o.id) ?? null}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function OfferCard({
  offer,
  patientName,
}: {
  offer: MedevacOfferRow;
  patientName: string | null;
}) {
  return (
    <article className="rounded-xl border border-border bg-navy-card/30 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusClass(offer.status)}`}
          >
            {STATUS_LABELS[offer.status]}
          </span>
          {offer.status === 'accepted' && patientName && (
            <p className="font-ar mt-2 text-sm text-emerald-200">
              المريض: <span className="text-ink-primary">{patientName}</span>
            </p>
          )}
        </div>
        <span className="font-ar text-xs text-ink-muted">
          {fmtDate(offer.created_at)}
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
          label="موعد الإقلاع"
          value={fmtDate(offer.proposed_pickup_at)}
        />
        <Row
          label="موعد الوصول"
          value={fmtDate(offer.proposed_arrival_at)}
        />
        {offer.decline_reason && (
          <Row label="سبب الرفض" value={offer.decline_reason} />
        )}
        {offer.withdraw_reason && (
          <Row label="سبب السحب" value={offer.withdraw_reason} />
        )}
      </dl>
    </article>
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
