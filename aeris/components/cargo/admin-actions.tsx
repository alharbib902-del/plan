'use client';

import { useState, useTransition } from 'react';

import { cargoAr } from '@/lib/i18n/cargo-ar';
import {
  adminAcceptCargoOfferOnBehalf,
  adminDeclineCargoOfferOnBehalf,
  adminCancelCargoRequestOnBehalf,
} from '@/app/actions/cargo-admin';

/**
 * Phase 11 PR 2 — admin action buttons for guest cargo requests.
 *
 * Visible ONLY when request.client_id IS NULL (guest path). The
 * admin Server Actions also reject `admin_cannot_accept_for_authed_client`
 * if called against an authed request — defense-in-depth so the
 * button is harmless if accidentally rendered.
 *
 * Mirrors client-actions.tsx layout (window.confirm + window.prompt
 * for optional reason) — same UX pattern.
 */

function adminErrorMessage(code: string): string {
  switch (code) {
    case 'actor_ambiguous':
      return cargoAr.errorActorAmbiguous;
    case 'offer_not_found':
      return cargoAr.errorOfferNotFound;
    case 'offer_not_pending':
      return cargoAr.errorOfferNotPending;
    case 'offer_expired':
      return cargoAr.errorOfferExpired;
    case 'request_not_found':
      return cargoAr.errorRequestNotFound;
    case 'request_not_open':
      return cargoAr.errorRequestNotOpen;
    case 'request_expired':
      return cargoAr.errorRequestExpired;
    case 'admin_cannot_accept_for_authed_client':
      return cargoAr.errorAdminCannotAcceptAuthed;
    case 'admin_cannot_decline_authed':
      return cargoAr.errorAdminCannotDeclineAuthed;
    case 'admin_cannot_cancel_authed':
      return cargoAr.errorAdminCannotCancelAuthed;
    case 'request_already_accepted':
      return cargoAr.errorRequestAccepted;
    case 'request_not_cancellable':
      return cargoAr.errorRequestNotCancellable;
    case 'flag_disabled':
      return cargoAr.errorFlagDisabled;
    case 'reason_too_long':
      return cargoAr.errorReasonTooLong;
    case 'validation_failed':
      return cargoAr.errorValidation;
    default:
      return cargoAr.errorServerError;
  }
}

// ============================================================
// AdminAcceptOnBehalfButton
// ============================================================

export function AdminAcceptOnBehalfButton({ offerId }: { offerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onClick = () => {
    if (typeof window === 'undefined') return;
    if (!window.confirm(cargoAr.adminConfirmAcceptOnBehalfBody)) return;
    setErrorCode(null);
    startTransition(async () => {
      const result = await adminAcceptCargoOfferOnBehalf({ offer_id: offerId });
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
          {adminErrorMessage(errorCode)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar inline-flex items-center gap-1 rounded border border-emerald-400/50 bg-emerald-500/15 px-3 py-1 text-xs text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:opacity-60"
      >
        {cargoAr.adminAcceptOnBehalfCta}
      </button>
    </div>
  );
}

// ============================================================
// AdminDeclineOnBehalfButton
// ============================================================

export function AdminDeclineOnBehalfButton({ offerId }: { offerId: string }) {
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
      const result = await adminDeclineCargoOfferOnBehalf({
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
          {adminErrorMessage(errorCode)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar inline-flex items-center gap-1 rounded border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
      >
        {cargoAr.adminDeclineOnBehalfCta}
      </button>
    </div>
  );
}

// ============================================================
// AdminCancelRequestButton
// ============================================================

export function AdminCancelRequestButton({ requestId }: { requestId: string }) {
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
      const result = await adminCancelCargoRequestOnBehalf({
        request_id: requestId,
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
          {adminErrorMessage(errorCode)}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar inline-flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
      >
        {cargoAr.adminCancelRequestCta}
      </button>
    </div>
  );
}
