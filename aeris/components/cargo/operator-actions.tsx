'use client';

import { useState, useTransition } from 'react';

import { cargoAr } from '@/lib/i18n/cargo-ar';
import { withdrawMyCargoOffer } from '@/app/actions/cargo-operators';

/**
 * Phase 11 PR 2 — operator withdraw button.
 *
 * Wraps withdrawMyCargoOffer Server Action. Reuses Phase 10
 * cancel-empty-leg pattern (window.confirm + window.prompt for
 * optional reason).
 */

function withdrawErrorMessage(code: string): string {
  switch (code) {
    case 'offer_not_found':
      return cargoAr.errorOfferNotFound;
    case 'offer_not_pending':
      return cargoAr.errorOfferNotPending;
    case 'forbidden':
      return cargoAr.errorForbidden;
    case 'must_change_password_first':
      return cargoAr.errorMustChangePassword;
    case 'flag_disabled':
      return cargoAr.errorFlagDisabled;
    case 'reason_too_long':
      return cargoAr.errorReasonTooLong;
    default:
      return cargoAr.errorServerError;
  }
}

export function WithdrawOfferButton({ offerId }: { offerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onClick = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm(cargoAr.operatorMyOffersConfirmWithdrawBody)) return;
    const reason =
      window.prompt(
        cargoAr.meDetailReasonLabel + '\n' + cargoAr.meDetailReasonPlaceholder
      ) ?? undefined;
    setErrorCode(null);
    startTransition(async () => {
      const result = await withdrawMyCargoOffer({
        offer_id: offerId,
        reason: reason && reason.trim().length > 0 ? reason : undefined,
      });
      if (!result.ok) setErrorCode(result.error);
    });
  };

  return (
    <div className="space-y-1">
      {errorCode ? (
        <p
          role="alert"
          className="font-ar rounded border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-100"
        >
          {withdrawErrorMessage(errorCode)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar inline-flex items-center gap-1 rounded border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
      >
        {cargoAr.operatorMyOffersWithdrawCta}
      </button>
    </div>
  );
}
