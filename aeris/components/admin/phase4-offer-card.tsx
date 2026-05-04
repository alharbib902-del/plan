import { MessageCircle, Phone } from 'lucide-react';
import type { Phase4OperatorOfferRow } from '@/types/database';
import { formatPhone, formatSAR } from '@/lib/utils/format';
import { AIRCRAFT_CATEGORY_LABEL_AR } from '@/lib/validators/promote-lead';
import { AcceptOfferButton } from './accept-offer-button';

function formatDateTimeAr(value: string | null): string {
  if (!value) return '—';
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

const STATUS_STYLE: Record<Phase4OperatorOfferRow['status'], string> = {
  pending: 'border-gold/40 bg-gold/10 text-gold-light',
  viewed: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  accepted: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  rejected: 'border-red-400/40 bg-red-500/10 text-red-200',
  expired: 'border-border bg-navy-secondary/60 text-ink-muted',
};

const STATUS_LABEL_AR: Record<Phase4OperatorOfferRow['status'], string> = {
  pending: 'قيد المراجعة',
  viewed: 'تمت المشاهدة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  expired: 'منتهي الصلاحية',
};

export function Phase4OfferCard({ offer }: { offer: Phase4OperatorOfferRow }) {
  const isPending = offer.status === 'pending';

  return (
    <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-ar text-base font-medium text-ink">
            {offer.operator_name}
          </h3>
          {offer.operator_phone && (
            <a
              href={`tel:${offer.operator_phone}`}
              dir="ltr"
              className="font-ar mt-0.5 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-gold-light"
            >
              <Phone className="h-3.5 w-3.5" aria-hidden />
              {formatPhone(offer.operator_phone)}
            </a>
          )}
        </div>
        <span
          className={`font-ar inline-flex items-center rounded-full border px-3 py-1 text-xs ${STATUS_STYLE[offer.status]}`}
        >
          {STATUS_LABEL_AR[offer.status]}
        </span>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label="السعر الإجمالي">
          <span className="font-ar text-base text-gold-light">
            {formatSAR(Number(offer.total_price_sar))}
          </span>
        </Field>
        <Field label="موعد الإقلاع المقترح">
          {formatDateTimeAr(offer.departure_eta)}
        </Field>
        {offer.aircraft_category && (
          <Field label="فئة الطائرة">
            {AIRCRAFT_CATEGORY_LABEL_AR[offer.aircraft_category]}
          </Field>
        )}
        {offer.aircraft_type && (
          <Field label="نوع الطائرة">{offer.aircraft_type}</Field>
        )}
        {offer.aircraft_registration && (
          <Field label="رقم التسجيل">
            <span dir="ltr">{offer.aircraft_registration}</span>
          </Field>
        )}
        <Field label="ينتهي في">
          {formatDateTimeAr(offer.expires_at)}
        </Field>
        <Field label="مدة الصلاحية">{offer.validity_hours} ساعة</Field>
      </dl>

      {offer.notes && (
        <div className="rounded-md border border-border/60 bg-navy-secondary/40 p-3">
          <div className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
            ملاحظات المشغّل
          </div>
          <p className="font-ar mt-1 whitespace-pre-wrap text-sm text-ink-secondary">
            {offer.notes}
          </p>
        </div>
      )}

      {offer.operator_email && (
        <div className="font-ar text-xs text-ink-muted" dir="ltr">
          {offer.operator_email}
        </div>
      )}

      {offer.operator_phone && (
        <a
          href={`https://wa.me/${offer.operator_phone.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-ar inline-flex items-center gap-2 text-xs text-gold-light hover:text-gold"
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          واتساب للمشغّل
        </a>
      )}

      {isPending && <AcceptOfferButton offerId={offer.id} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </div>
      <div className="font-ar mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}
