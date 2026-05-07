'use client';

import { useState, useTransition } from 'react';

import { backfillBookingFromAcceptedOffer } from '@/app/(admin)/admin/actions/booking-addons';
import { t } from '@/lib/i18n/operator';

/**
 * Phase 6.2 PR 2b: Case C escape valve button.
 *
 * Calls `backfillBookingFromAcceptedOffer({ trip_request_id })`
 * Server Action which wraps PR 2a's
 * `backfill_booking_from_offer` SQL function. The function
 * counts accepted offers across both Phase 4 + Phase 5
 * tables (Codex iteration-3 P2 #1 fix); on the unique-
 * accepted happy path, INSERTs the bookings row using the
 * same shape as accept_offer's body.
 *
 * Idempotent: a second click on the same trip returns
 * `booking_already_exists` because the partial unique index
 * `bookings_trip_request_unique` enforces one row per trip.
 *
 * Button surfaces the founder-relevant errors verbatim:
 *   - `no_accepted_offer` — no accepted offer found.
 *   - `ambiguous_accepted_offer:N` — > 1 accepted offer
 *     exists; founder must investigate before retry.
 *   - `booking_already_exists` — idempotent re-click; just
 *     reload the page to see Case B.
 */
export function LegacyBookingBackfillButton({
  tripId,
}: {
  tripId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function onClick() {
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const result = await backfillBookingFromAcceptedOffer({
        trip_request_id: tripId,
      });
      if (result.ok) {
        setSuccess(true);
        // The Server Action revalidates the trip page; the
        // server component will re-render in Case B on the
        // next paint. No need to redirect manually.
      } else {
        setError(translateError(result.error));
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending || success}
        className="font-ar rounded-md bg-gold px-4 py-2 text-sm font-medium text-navy disabled:opacity-50"
      >
        {isPending
          ? '...'
          : success
            ? '✓ تم'
            : t('admin_addons_create_booking_button', 'ar')}
      </button>
      {success && (
        <p className="font-ar mt-3 rounded-md border border-emerald-400/40 bg-emerald-500/10 p-2 text-xs text-emerald-200">
          {t('admin_backfill_success', 'ar')}
        </p>
      )}
      {error && (
        <p
          className="font-ar mt-3 rounded-md border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-200"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

function translateError(code: string): string {
  // The ambiguous error ships the count via the
  // `ambiguous_accepted_offer:N` form (per the Server
  // Action's failure shape). Strip the count for display
  // but mention it in the user-facing copy so the founder
  // knows how many offers to inspect.
  if (code.startsWith('ambiguous_accepted_offer')) {
    const count = code.split(':')[1] ?? '?';
    return `يوجد ${count} عروض مقبولة لهذه الرحلة — راجع البيانات قبل الإنشاء.`;
  }
  const knownCodes: Record<string, string> = {
    no_accepted_offer: 'err_no_accepted_offer',
    booking_already_exists: 'err_booking_already_exists',
    trip_not_found: 'err_trip_not_found',
    trip_not_booked: 'err_trip_not_booked',
    validation_failed: 'err_validation_failed',
    rpc_failed: 'err_rpc_failed',
  };
  const i18nKey = knownCodes[code] ?? 'err_rpc_failed';
  return t(i18nKey as 'err_rpc_failed', 'ar');
}
