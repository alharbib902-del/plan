import type { TripRequestRow } from '@/types/database';
import { AIRCRAFT_CATEGORY_LABEL_AR } from '@/lib/validators/promote-lead';

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

/**
 * Read-only trip summary shown to the operator. Customer name and
 * phone are intentionally NOT included — Phase 4 keeps client
 * identity private until acceptance.
 */
export function OperatorTripSummary({ trip }: { trip: TripRequestRow }) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-6">
      <div className="font-mono text-sm text-gold-light">
        {trip.request_number}
      </div>
      <h2 className="font-ar mt-1 text-xl text-ink">تفاصيل الرحلة</h2>

      <dl className="mt-4">
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
          <Row label="فئة الطائرة المطلوبة">
            {AIRCRAFT_CATEGORY_LABEL_AR[trip.aircraft_category_preference]}
          </Row>
        )}
        {trip.special_requests && (
          <Row label="متطلبات خاصة">
            <span className="whitespace-pre-wrap">{trip.special_requests}</span>
          </Row>
        )}
      </dl>
    </div>
  );
}
