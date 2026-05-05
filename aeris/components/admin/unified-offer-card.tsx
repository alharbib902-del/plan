import { MessageCircle, Phone } from 'lucide-react';
import type { OfferStatus, UnifiedOfferRow } from '@/types/database';
import { formatPhone, formatSAR } from '@/lib/utils/format';
import { AIRCRAFT_CATEGORY_LABEL_AR } from '@/lib/validators/promote-lead';
import { AcceptOfferUnifiedButton } from './accept-offer-unified-button';

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

const STATUS_STYLE: Record<OfferStatus, string> = {
  pending: 'border-gold/40 bg-gold/10 text-gold-light',
  viewed: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  accepted: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  rejected: 'border-red-400/40 bg-red-500/10 text-red-200',
  expired: 'border-border bg-navy-secondary/60 text-ink-muted',
};

const STATUS_LABEL_AR: Record<OfferStatus, string> = {
  pending: 'قيد المراجعة',
  viewed: 'تمت المشاهدة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  expired: 'منتهي الصلاحية',
};

/**
 * Unified offer card used by the Phase 5 admin comparison view.
 *
 * Renders any offer regardless of source (Phase 4 or Phase 5),
 * shows a small `source` badge so admin knows whether the offer
 * came from a v=1 link (Phase 4 single-operator) or a v=2 link
 * (Phase 5 multi-operator round). Phase 5 offers also carry a
 * "current round" badge if the dispatch round is still open and
 * is the trip's `current_dispatch_round_id`.
 *
 * The accept button is rendered ONLY when the trip is still
 * `offered` (passed in via tripIsOffered) and the offer is
 * `pending`. The unified `accept_offer` RPC is the only
 * application path; the legacy `acceptOffer` Server Action is
 * no longer called from this UI.
 */
export function UnifiedOfferCard({
  offer,
  tripIsOffered,
}: {
  offer: UnifiedOfferRow;
  tripIsOffered: boolean;
}) {
  const showAccept = tripIsOffered && offer.status === 'pending';
  const isPhase5 = offer.source === 'phase5';
  const isCurrentRound = isPhase5 && offer.is_current_round === true;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-ar text-base font-medium text-ink">
              {offer.operator_name}
            </h3>
            <SourceBadge source={offer.source} isCurrentRound={isCurrentRound} />
          </div>
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
            {formatSAR(offer.total_price_sar)}
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
        {isPhase5 && offer.target_phone && (
          <Field label="رقم المشغّل المُرسَل إليه">
            <span dir="ltr">{formatPhone(offer.target_phone)}</span>
          </Field>
        )}
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

      {showAccept && (
        <AcceptOfferUnifiedButton offerId={offer.id} offerSource={offer.source} />
      )}
    </div>
  );
}

function SourceBadge({
  source,
  isCurrentRound,
}: {
  source: 'phase4' | 'phase5';
  isCurrentRound: boolean;
}) {
  if (source === 'phase4') {
    return (
      <span className="font-ar inline-flex items-center rounded-full border border-border bg-navy-secondary/60 px-2 py-0.5 text-[10px] text-ink-muted">
        قديم
      </span>
    );
  }
  return (
    <span
      className={`font-ar inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
        isCurrentRound
          ? 'border-gold/40 bg-gold/10 text-gold-light'
          : 'border-border bg-navy-secondary/60 text-ink-muted'
      }`}
    >
      {isCurrentRound ? 'جولة حالية' : 'جولة سابقة'}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </div>
      <div className="font-ar mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}
