'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { cancelMyTripRequest } from '@/app/actions/clients-trip-requests';
import { ClientBanner, clientErrorMessage } from './error-banner';

/**
 * Phase 9 PR 3 — cancel-trip button on the request detail
 * surface. Wraps the PR 2 `cancelMyTripRequest` Server Action.
 *
 * Renders ONLY when the parent trip is in a cancellable
 * status (the page decides). On click: window.confirm() to
 * guard against accidental clicks, then call the action.
 * Successful cancel → page revalidates server-side; UI shows
 * a brief success banner before the new render replaces the
 * button with the cancelled-status chip.
 */

interface CancelTripButtonProps {
  tripRequestId: string;
}

export function CancelTripButton({ tripRequestId }: CancelTripButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onClick = () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(clientsAr.cancelTripConfirm)
    ) {
      return;
    }
    setErrorCode(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await cancelMyTripRequest({
        trip_request_id: tripRequestId,
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setSuccess(true);
    });
  };

  if (success) {
    return (
      <ClientBanner kind="success">
        <p>{clientsAr.cancelTripSuccess}</p>
      </ClientBanner>
    );
  }

  return (
    <div className="space-y-2">
      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
      >
        {isPending
          ? clientsAr.cancelTripSubmitting
          : clientsAr.cancelTripSubmit}
      </button>
    </div>
  );
}
