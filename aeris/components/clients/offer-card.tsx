'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import {
  clientAcceptOffer,
  clientDeclineOffer,
} from '@/app/actions/clients-trip-requests';
import { CashbackRedeemInput } from '@/components/privilege/cashback-redeem-input';
import type { OfferSource, OfferStatus } from '@/types/database';
import { ClientBanner, clientErrorMessage } from './error-banner';
import {
  OFFER_STATUS_LABEL,
  OFFER_STATUS_TONE,
  aircraftLabel,
  formatDateTimeAr,
  formatSARLabel,
  offerSourceLabel,
} from './offer-format';

/**
 * Phase 9 PR 3 — client-side offer card.
 *
 * Mirrors `components/admin/unified-offer-card.tsx` shape but
 * scoped to the client surface (single component, no admin
 * controls). Renders any offer regardless of source (phase4 |
 * phase5) plus accept + decline buttons that call the
 * client-side Server Actions (which enforce ownership +
 * status guards before delegating to the existing
 * `accept_offer` RPC).
 *
 * Buttons are rendered ONLY when the parent trip is still
 * open for offers (`tripIsActionable`) AND this offer's
 * status is `pending`. Anything else renders the status
 * label only (read-only).
 */

export type ClientOfferRow = {
  source: OfferSource;
  id: string;
  trip_request_id: string;
  operator_name: string;
  total_price_sar: number;
  departure_eta: string | null;
  expires_at: string | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  status: OfferStatus;
  is_current_round?: boolean | null;
};

interface ClientOfferCardProps {
  offer: ClientOfferRow;
  tripIsActionable: boolean;
  /**
   * Phase 13 PR 3 round 2 — optional cashback context. When
   * `privilegeEnabled = true` AND `cashbackBalanceSar > 0`, the
   * card renders CashbackRedeemInput above the action buttons.
   * Defaults preserve Phase 9 accept UX exactly when omitted.
   */
  privilegeEnabled?: boolean;
  cashbackBalanceSar?: number;
}

export function ClientOfferCard({
  offer,
  tripIsActionable,
  privilegeEnabled = false,
  cashbackBalanceSar = 0,
}: ClientOfferCardProps) {
  const showActions = tripIsActionable && offer.status === 'pending';
  const [isAccepting, startAccept] = useTransition();
  const [isDeclining, startDecline] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [redemption, setRedemption] = useState<number>(0);
  const [redeemWarning, setRedeemWarning] = useState<string | null>(null);

  const showRedemption =
    showActions && privilegeEnabled && cashbackBalanceSar > 0;

  const onAccept = () => {
    if (
      !confirm(
        'هل أنت متأكد من قبول هذا العرض؟ سيتم رفض جميع العروض الأخرى تلقائيًا.'
      )
    ) {
      return;
    }
    setErrorCode(null);
    setRedeemWarning(null);
    startAccept(async () => {
      const result = await clientAcceptOffer({
        offer_id: offer.id,
        source: offer.source,
        ...(redemption > 0 ? { cashback_redemption_sar: redemption } : {}),
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      if (
        result.cashback_redemption &&
        result.cashback_redemption.ok === false
      ) {
        setRedeemWarning(result.cashback_redemption.error);
      }
      // success → page revalidates server-side via the Server
      // Action; let the route refresh handle the UI update.
    });
  };

  const onDecline = () => {
    if (!confirm('هل أنت متأكد من رفض هذا العرض؟')) {
      return;
    }
    setErrorCode(null);
    startDecline(async () => {
      const result = await clientDeclineOffer({
        offer_id: offer.id,
        source: offer.source,
      });
      if (!result.ok) setErrorCode(result.error);
    });
  };

  const isPending = isAccepting || isDeclining;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-ar text-base font-medium text-ink-primary">
              {offer.operator_name}
            </h3>
            <SourceBadge
              source={offer.source}
              isCurrentRound={offer.is_current_round === true}
            />
          </div>
        </div>
        <span
          className={`font-ar inline-flex items-center rounded-full border px-3 py-1 text-xs ${OFFER_STATUS_TONE[offer.status]}`}
        >
          {OFFER_STATUS_LABEL[offer.status]}
        </span>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Field label={clientsAr.offerPriceLabel}>
          <span className="font-ar text-base text-gold-light">
            {formatSARLabel(offer.total_price_sar)}
          </span>
        </Field>
        <Field label={clientsAr.offerDepartureEtaLabel}>
          {formatDateTimeAr(offer.departure_eta)}
        </Field>
        <Field label={clientsAr.offerAircraftLabel}>
          <span dir="ltr">{aircraftLabel(offer)}</span>
        </Field>
        <Field label={clientsAr.offerExpiresLabel}>
          {formatDateTimeAr(offer.expires_at)}
        </Field>
      </dl>

      {showRedemption ? (
        <CashbackRedeemInput
          bookingTotalSar={offer.total_price_sar}
          currentBalanceSar={cashbackBalanceSar}
          value={redemption}
          onChange={setRedemption}
          disabled={isPending}
        />
      ) : null}

      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}

      {redeemWarning ? (
        <ClientBanner kind="warning">
          تم القبول، لكن لم يُحسم رصيد الاسترداد. ادفع المبلغ كاملاً نقداً.
        </ClientBanner>
      ) : null}

      {showActions ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAccept}
            disabled={isPending}
            className="font-ar flex-1 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:opacity-60"
          >
            {isAccepting ? clientsAr.offerAccepting : clientsAr.offerAccept}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={isPending}
            className="font-ar rounded-lg border border-rose-400/40 bg-rose-500/15 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/25 disabled:opacity-60"
          >
            {isDeclining ? clientsAr.offerDeclining : clientsAr.offerDecline}
          </button>
        </div>
      ) : null}
    </div>
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
      <dt className="font-ar text-xs text-ink-muted">{label}</dt>
      <dd className="font-ar mt-1 text-sm text-ink-primary">{children}</dd>
    </div>
  );
}

function SourceBadge({
  source,
  isCurrentRound,
}: {
  source: ClientOfferRow['source'];
  isCurrentRound: boolean;
}) {
  const label = offerSourceLabel(source, isCurrentRound);
  return (
    <span className="font-ar rounded-full border border-border bg-navy-secondary/60 px-2 py-0.5 text-[10px] text-ink-muted">
      {label}
    </span>
  );
}
