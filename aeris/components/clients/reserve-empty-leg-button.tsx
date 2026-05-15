'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { reserveAuthenticatedEmptyLeg } from '@/app/actions/clients-empty-legs';

import { ClientBanner, clientErrorMessage } from './error-banner';

/**
 * Phase 10 PR 2 — reserve button for /me/empty-legs/[leg_number].
 *
 * Wraps reserveAuthenticatedEmptyLeg Server Action (PR 1).
 * Shown when the leg is `available` AND the client doesn't
 * already hold a reservation. After successful reserve, the
 * page revalidates server-side and re-renders with the
 * "تم الحجز — في انتظار تأكيد الإدارة" banner instead of this
 * button (status flips to 'reserved' + reservation_client_id
 * matches session.client_id).
 *
 * Opaque error contracts surface via clientErrorMessage which
 * looks up emptyLegsErrors[code] in clients-ar.ts; unmapped
 * codes fall through to the generic server_error string.
 */

interface ReserveEmptyLegButtonProps {
  legId: string;
}

export function ReserveEmptyLegButton({ legId }: ReserveEmptyLegButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onClick = () => {
    setErrorCode(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await reserveAuthenticatedEmptyLeg({ leg_id: legId });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setSuccess(true);
      // Server revalidatePath in the action will re-render the
      // parent page on next navigation/refresh; the success
      // banner is a transient affordance so the user sees
      // immediate feedback before the page reload.
    });
  };

  if (success) {
    return (
      <ClientBanner kind="success">
        <p>{clientsAr.emptyLegsReservedBanner}</p>
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
        className="font-ar w-full rounded-lg border border-gold/50 bg-gold/15 px-5 py-3 text-base font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60 sm:w-auto"
      >
        {isPending ? clientsAr.emptyLegsReserving : clientsAr.emptyLegsReserveCta}
      </button>
    </div>
  );
}

/** Resolve a Phase 10 empty-leg error code to a localized
 *  string. Falls back to the generic Phase 9
 *  clientErrorMessage helper if the code isn't in
 *  emptyLegsErrors. */
function emptyLegErrorMessage(code: string): string {
  const map = clientsAr.emptyLegsErrors;
  if (Object.prototype.hasOwnProperty.call(map, code)) {
    return map[code]!;
  }
  return clientErrorMessage(code);
}
