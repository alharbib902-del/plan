import { MessageCircle, Phone } from 'lucide-react';
import type { TripRequestRow } from '@/types/database';
import { formatPhone } from '@/lib/utils/format';
import { AIRCRAFT_CATEGORY_LABEL_AR } from '@/lib/validators/promote-lead';
import { TripStatusBadge } from './trip-status-badge';

const LEAD_TRIP_LABEL_AR: Record<string, string> = {
  one_way: 'ذهاب فقط',
  round_trip: 'ذهاب وعودة',
  multi_city: 'متعدد الوجهات',
};

function formatDateAr(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDateTimeAr(value: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-3 border-t border-border/60 py-3 sm:grid-cols-[160px,1fr]">
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar text-sm text-ink">{children}</dd>
    </div>
  );
}

export function TripDetailCard({ trip }: { trip: TripRequestRow }) {
  const customerWa = trip.customer_phone
    ? `https://wa.me/${trip.customer_phone.replace(/\D/g, '')}`
    : null;
  const leadTripType =
    typeof trip.preferences === 'object' && trip.preferences !== null
      ? (trip.preferences as Record<string, unknown>).lead_trip_type
      : undefined;
  const leadTripTypeLabel =
    typeof leadTripType === 'string' && LEAD_TRIP_LABEL_AR[leadTripType]
      ? LEAD_TRIP_LABEL_AR[leadTripType]
      : null;

  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm text-gold-light">
              {trip.request_number}
            </div>
            <TripStatusBadge status={trip.status} />
          </div>
          <h2 className="font-ar mt-1 text-2xl text-ink">
            {trip.customer_name ?? 'بدون اسم'}
          </h2>
        </div>
        {trip.customer_phone ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`tel:${trip.customer_phone}`}
              className="font-ar inline-flex items-center gap-2 rounded-md border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light"
              dir="ltr"
            >
              <Phone className="h-4 w-4" aria-hidden />
              {formatPhone(trip.customer_phone)}
            </a>
            {customerWa && (
              <a
                href={customerWa}
                target="_blank"
                rel="noopener noreferrer"
                className="font-ar inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                واتساب
              </a>
            )}
          </div>
        ) : null}
      </div>

      <dl className="mt-6">
        <Row label="نوع المنتج">شارتر</Row>
        {leadTripTypeLabel && (
          <Row label="طلب العميل الأصلي">{leadTripTypeLabel}</Row>
        )}
        <Row label="المسار">
          <ol className="space-y-1">
            {(trip.legs ?? []).map((leg, idx) => (
              <li key={idx} className="font-ar">
                <span className="text-ink-muted">[{idx + 1}]</span>{' '}
                {leg.from} ← {leg.to}
                <span className="ms-2 text-xs text-ink-muted">
                  {formatDateAr(leg.date)}
                </span>
              </li>
            ))}
          </ol>
        </Row>
        <Row label="المغادرة">{formatDateAr(trip.departure_date)}</Row>
        {trip.return_date && (
          <Row label="العودة">{formatDateAr(trip.return_date)}</Row>
        )}
        <Row label="عدد الركاب">{trip.passengers_count}</Row>
        {trip.aircraft_category_preference && (
          <Row label="فئة الطائرة">
            {AIRCRAFT_CATEGORY_LABEL_AR[trip.aircraft_category_preference]}
          </Row>
        )}
        <Row label="متطلبات خاصة">
          {trip.special_requests ? (
            <span className="whitespace-pre-wrap">{trip.special_requests}</span>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </Row>
        <Row label="مصدر العميل">{trip.customer_source ?? '—'}</Row>
        <Row label="أنشئ في">{formatDateTimeAr(trip.created_at)}</Row>
      </dl>
    </div>
  );
}
