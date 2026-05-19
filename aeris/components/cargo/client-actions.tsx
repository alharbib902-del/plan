'use client';

import { useState, useTransition } from 'react';

import { cargoAr } from '@/lib/i18n/cargo-ar';
import {
  acceptMyCargoOffer,
  declineMyCargoOffer,
  cancelMyCargoRequest,
} from '@/app/actions/cargo-clients';
import { CashbackRedeemInput } from '@/components/privilege/cashback-redeem-input';

/**
 * Phase 11 PR 2 — client-side action buttons for the cargo
 * detail page (/me/cargo-requests/[id]).
 *
 * 3 buttons, all destructive → guarded by window.confirm() per
 * Phase 10 cancel-empty-leg pattern. The detail page server
 * component decides visibility via the `acceptable` flag from
 * loadMyCargoRequestDetail; these components just render +
 * handle the action.
 *
 * Decline + cancel allow an optional reason (free text, capped
 * at 500 chars by Zod + DB CHECK). The reason is captured via
 * window.prompt() — keeps the PR lean and matches the existing
 * /me/empty-legs cancel UX. A future PR can swap to a proper
 * modal.
 */

function cargoErrorMessage(code: string): string {
  const map = cargoAr as Record<string, unknown>;
  const key = errorKeyFor(code);
  const candidate = map[key];
  if (typeof candidate === 'string') return candidate;
  return cargoAr.errorServerError;
}

function errorKeyFor(code: string): string {
  switch (code) {
    case 'actor_ambiguous':
      return 'errorActorAmbiguous';
    case 'offer_not_found':
      return 'errorOfferNotFound';
    case 'offer_not_pending':
      return 'errorOfferNotPending';
    case 'offer_expired':
      return 'errorOfferExpired';
    case 'request_not_found':
      return 'errorRequestNotFound';
    case 'request_not_open':
      return 'errorRequestNotOpen';
    case 'request_expired':
      return 'errorRequestExpired';
    case 'forbidden':
    case 'not_your_request':
      return 'errorForbidden';
    case 'admin_cannot_accept_for_authed_client':
      return 'errorAdminCannotAcceptAuthed';
    case 'admin_cannot_decline_authed':
      return 'errorAdminCannotDeclineAuthed';
    case 'admin_cannot_cancel_authed':
      return 'errorAdminCannotCancelAuthed';
    case 'request_already_accepted':
      return 'errorRequestAccepted';
    case 'request_not_cancellable':
      return 'errorRequestNotCancellable';
    case 'flag_disabled':
      return 'errorFlagDisabled';
    case 'reason_too_long':
      return 'errorReasonTooLong';
    case 'must_change_password_first':
      return 'errorMustChangePassword';
    case 'unauthorized':
      return 'errorUnauthorized';
    case 'validation_failed':
      return 'errorValidation';
    default:
      return 'errorServerError';
  }
}

// ============================================================
// AcceptOfferButton
// ============================================================

export function AcceptOfferButton({
  offerId,
  offerTotalSar,
  cashbackBalanceSar = 0,
  privilegeEnabled = false,
}: {
  offerId: string;
  /** Required when privilegeEnabled = true so the D7 caps in
   *  CashbackRedeemInput can validate locally. Server-side
   *  redeem_cashback_for_booking re-validates against the
   *  authoritative booking row. */
  offerTotalSar?: number;
  cashbackBalanceSar?: number;
  privilegeEnabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [redemption, setRedemption] = useState<number>(0);
  const [redeemWarning, setRedeemWarning] = useState<string | null>(null);

  const showRedemption =
    privilegeEnabled && cashbackBalanceSar > 0 && typeof offerTotalSar === 'number';

  const onClick = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm(cargoAr.meDetailConfirmAcceptBody)) return;
    setErrorCode(null);
    setRedeemWarning(null);
    startTransition(async () => {
      const result = await acceptMyCargoOffer({
        offer_id: offerId,
        ...(redemption > 0 ? { cashback_redemption_sar: redemption } : {}),
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      // Booking created. If the optional redemption failed, the
      // accept itself still succeeded — surface a soft warning
      // so the user knows the cash amount is full price.
      if (
        result.cashback_redemption &&
        result.cashback_redemption.ok === false
      ) {
        setRedeemWarning(result.cashback_redemption.error);
      }
      // Page revalidates → button disappears (acceptable=false).
    });
  };

  return (
    <div className="space-y-3">
      {showRedemption && offerTotalSar !== undefined ? (
        <CashbackRedeemInput
          bookingTotalSar={offerTotalSar}
          currentBalanceSar={cashbackBalanceSar}
          value={redemption}
          onChange={setRedemption}
          disabled={isPending}
        />
      ) : null}
      {errorCode ? (
        <p
          role="alert"
          className="font-ar rounded border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100"
        >
          {cargoErrorMessage(errorCode)}
        </p>
      ) : null}
      {redeemWarning ? (
        <p
          role="alert"
          className="font-ar rounded border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100"
        >
          تم القبول، لكن لم يُحسم رصيد الاسترداد. ادفع المبلغ كاملاً نقداً.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar inline-flex items-center gap-2 rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:opacity-60"
      >
        {isPending ? cargoAr.actionAcceptSuccess : cargoAr.meDetailOfferAcceptCta}
      </button>
    </div>
  );
}

// ============================================================
// DeclineOfferButton
// ============================================================

export function DeclineOfferButton({ offerId }: { offerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onClick = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm(cargoAr.meDetailConfirmDeclineTitle)) return;
    const reason =
      window.prompt(
        cargoAr.meDetailReasonLabel + '\n' + cargoAr.meDetailReasonPlaceholder
      ) ?? undefined;
    setErrorCode(null);
    startTransition(async () => {
      const result = await declineMyCargoOffer({
        offer_id: offerId,
        reason: reason && reason.trim().length > 0 ? reason : undefined,
      });
      if (!result.ok) setErrorCode(result.error);
    });
  };

  return (
    <div className="space-y-2">
      {errorCode ? (
        <p
          role="alert"
          className="font-ar rounded border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100"
        >
          {cargoErrorMessage(errorCode)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar inline-flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
      >
        {cargoAr.meDetailOfferDeclineCta}
      </button>
    </div>
  );
}

// ============================================================
// CancelRequestButton
// ============================================================

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onClick = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm(cargoAr.meDetailConfirmCancelBody)) return;
    const reason =
      window.prompt(
        cargoAr.meDetailReasonLabel + '\n' + cargoAr.meDetailReasonPlaceholder
      ) ?? undefined;
    setErrorCode(null);
    startTransition(async () => {
      const result = await cancelMyCargoRequest({
        request_id: requestId,
        reason: reason && reason.trim().length > 0 ? reason : undefined,
      });
      if (!result.ok) setErrorCode(result.error);
    });
  };

  return (
    <div className="space-y-2">
      {errorCode ? (
        <p
          role="alert"
          className="font-ar rounded border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-100"
        >
          {cargoErrorMessage(errorCode)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar inline-flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
      >
        {cargoAr.meDetailRequestCancelCta}
      </button>
    </div>
  );
}
