'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { cancelMyEmptyLegReservation } from '@/app/actions/clients-empty-legs';

import { ClientBanner, clientErrorMessage } from './error-banner';

/**
 * Phase 10 PR 2 — cancel button for State C reservations on
 * /me/empty-legs/[leg_number].
 *
 * Wraps cancelMyEmptyLegReservation Server Action (PR 1).
 * Shown ONLY when the leg is in State C AND the
 * reservation_client_id matches the authenticated client.
 * The page server component decides visibility; this component
 * just renders + handles the click.
 *
 * Triple-guarded behind a window.confirm() prompt because cancel
 * is destructive (clears the 1-hour hold and lets another client
 * grab the leg). Single opaque cancel_not_allowed error per
 * spec §4.6 — UI message is constant Arabic copy.
 */

interface CancelEmptyLegButtonProps {
  legId: string;
}

export function CancelEmptyLegButton({ legId }: CancelEmptyLegButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onClick = () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(clientsAr.emptyLegsCancelConfirm)
    ) {
      return;
    }
    setErrorCode(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await cancelMyEmptyLegReservation({ leg_id: legId });
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
        <p>{clientsAr.emptyLegsCancelledBanner}</p>
      </ClientBanner>
    );
  }

  return (
    <div className="space-y-2">
      {errorCode ? (
        <ClientBanner kind="error">
          {emptyLegErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="font-ar rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
      >
        {isPending
          ? clientsAr.emptyLegsCancelling
          : clientsAr.emptyLegsCancelReservation}
      </button>
    </div>
  );
}

function emptyLegErrorMessage(code: string): string {
  const map = clientsAr.emptyLegsErrors;
  if (Object.prototype.hasOwnProperty.call(map, code)) {
    return map[code]!;
  }
  return clientErrorMessage(code);
}
