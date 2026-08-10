'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { markBookingPaidOffline } from '@/app/(admin)/admin/actions/mark-paid';
import { formatSARLabel } from '@/components/clients/offer-format';
import { t } from '@/lib/i18n/operator';

/**
 * Admin "confirm payment received" (offline settlement) control.
 *
 * Sits in the payment section of the admin trip add-ons page (Case B).
 * Two-step confirm: the first click arms the button, the second actually
 * calls the Server Action — flipping a booking to paid is irreversible
 * (immutability trigger) and cascades cashback/tier/referral, so a single
 * misclick must not fire it.
 *
 * On success the router refreshes so the payment badge re-renders from the
 * updated bookings row (the action already revalidated the trip paths).
 */
export function MarkPaidButton({
  bookingId,
  tripId,
  netAmount,
}: {
  bookingId: string;
  tripId: string;
  netAmount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'paid' | 'already' | null>(null);

  function onClick() {
    setError(null);
    if (!armed) {
      setArmed(true);
      return;
    }

    startTransition(async () => {
      const result = await markBookingPaidOffline({
        booking_id: bookingId,
        trip_id: tripId,
        reference: reference.trim() || undefined,
      });
      setArmed(false);
      if (result.ok) {
        setDone(result.already ? 'already' : 'paid');
        router.refresh();
      } else {
        setError(translateError(result.error));
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4">
        <p className="font-ar text-sm font-medium text-emerald-200">
          {done === 'paid'
            ? t('admin_mark_paid_success', 'ar')
            : t('admin_mark_paid_already', 'ar')}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="font-ar text-sm text-ink">
        {t('admin_payment_net_amount_label', 'ar')}:{' '}
        <span className="font-medium text-gold-light">
          {formatSARLabel(netAmount)}
        </span>
      </p>

      <label className="font-ar mt-3 block text-xs text-ink-muted">
        {t('admin_mark_paid_reference_label', 'ar')}
        <input
          type="text"
          value={reference}
          maxLength={200}
          onChange={(e) => setReference(e.target.value)}
          className="font-mono mt-1 block w-full rounded-md border border-border bg-navy-card/40 px-3 py-2 text-xs text-ink"
        />
      </label>

      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className={`font-ar mt-4 rounded-md border px-4 py-2 text-sm disabled:opacity-50 ${
          armed
            ? 'border-amber-400/70 bg-amber-500/20 text-amber-100'
            : 'border-emerald-400/60 bg-emerald-500/10 text-emerald-200'
        }`}
      >
        {isPending
          ? '...'
          : armed
            ? t('admin_mark_paid_confirm_button', 'ar')
            : t('admin_mark_paid_button', 'ar')}
      </button>

      <p className="font-ar mt-2 text-xs text-ink-muted">
        {t('admin_mark_paid_hint', 'ar')}
      </p>

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
  if (code === 'secret_not_set') {
    return t('admin_addons_secret_not_set_error', 'ar');
  }
  const knownCodes: Record<string, string> = {
    booking_not_found: 'err_booking_not_found',
    already_paid: 'err_already_paid',
    booking_refunded: 'err_booking_refunded',
    validation_failed: 'err_validation_failed',
    rpc_failed: 'err_rpc_failed',
  };
  const i18nKey = knownCodes[code] ?? 'err_rpc_failed';
  return t(i18nKey as 'err_rpc_failed', 'ar');
}
