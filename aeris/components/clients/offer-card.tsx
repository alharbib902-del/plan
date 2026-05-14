'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import {
  clientAcceptOffer,
  clientDeclineOffer,
} from '@/app/actions/clients-trip-requests';
import { ClientBanner, clientErrorMessage } from './error-banner';

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
  source: 'phase4' | 'phase5';
  id: string;
  trip_request_id: string;
  operator_name: string;
  operator_phone: string | null;
  total_price_sar: number;
  departure_eta: string | null;
  expires_at: string | null;
  aircraft_type: string | null;
  aircraft_registration: string | null;
  status: 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  is_current_round?: boolean | null;
};

const OFFER_STATUS_LABEL: Record<
  ClientOfferRow['status'],
  string
> = {
  pending: clientsAr.offerStatusPending,
  viewed: clientsAr.offerStatusViewed,
  accepted: clientsAr.offerStatusAccepted,
  rejected: clientsAr.offerStatusRejected,
  expired: clientsAr.offerStatusExpired,
};

const OFFER_STATUS_TONE: Record<ClientOfferRow['status'], string> = {
  pending: 'border-gold/40 bg-gold/10 text-gold-light',
  viewed: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  accepted: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  rejected: 'border-rose-400/40 bg-rose-500/10 text-rose-200',
  expired: 'border-border bg-navy-secondary/60 text-ink-muted',
};

function formatSAR(amount: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

function formatDateTimeAr(value: string | null): string {
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

function aircraftLabel(offer: ClientOfferRow): string {
  const t = offer.aircraft_type?.trim() ?? '';
  const r = offer.aircraft_registration?.trim() ?? '';
  if (t && r) return `${t} (${r})`;
  if (t) return t;
  if (r) return r;
  return '—';
}

interface ClientOfferCardProps {
  offer: ClientOfferRow;
  tripIsActionable: boolean;
}

export function ClientOfferCard({
  offer,
  tripIsActionable,
}: ClientOfferCardProps) {
  const showActions = tripIsActionable && offer.status === 'pending';
  const [isAccepting, startAccept] = useTransition();
  const [isDeclining, startDecline] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onAccept = () => {
    setErrorCode(null);
    startAccept(async () => {
      const result = await clientAcceptOffer({
        offer_id: offer.id,
        source: offer.source,
      });
      if (!result.ok) setErrorCode(result.error);
      // success → page revalidates server-side via the Server
      // Action; let the route refresh handle the UI update.
    });
  };

  const onDecline = () => {
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
            {formatSAR(offer.total_price_sar)} ريال
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

      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
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
  const label =
    source === 'phase5' && isCurrentRound
      ? clientsAr.offerSourceCurrentRound
      : source === 'phase5'
        ? clientsAr.offerSourcePhase5
        : clientsAr.offerSourcePhase4;
  return (
    <span className="font-ar rounded-full border border-border bg-navy-secondary/60 px-2 py-0.5 text-[10px] text-ink-muted">
      {label}
    </span>
  );
}
