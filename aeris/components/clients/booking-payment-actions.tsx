'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { confirmCheckout } from '@/app/actions/payments';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { ClientBanner, clientErrorMessage } from './error-banner';

/**
 * Phase payments PR #120 — payment actions on the booking detail page.
 *
 * "ادفع الآن" links to the dedicated checkout page. When an active (initiated)
 * checkout already exists — e.g. the client paid but closed the tab before the
 * gateway redirect — "تحديث حالة الدفع" re-runs the server-side status lookup
 * (confirmCheckout) to settle the booking without waiting on the (deferred)
 * webhook. Rendered ONLY when ENABLE_PAYMENTS is on and the booking is payable
 * (gated by the server component).
 */
export function BookingPaymentActions({
  bookingId,
  activeCheckoutId,
}: {
  bookingId: string;
  activeCheckoutId: string | null;
}) {
  const router = useRouter();
  const [isChecking, startCheck] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onRefresh = () => {
    if (!activeCheckoutId) return;
    setError(null);
    setInfo(null);
    startCheck(async () => {
      const result = await confirmCheckout({ checkout_id: activeCheckoutId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.outcome === 'success') {
        router.refresh();
        return;
      }
      setInfo(clientsAr.paymentPendingBody);
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-navy-card/40 p-5">
      {error ? (
        <ClientBanner kind="error">{clientErrorMessage(error)}</ClientBanner>
      ) : null}
      {info ? <ClientBanner kind="info">{info}</ClientBanner> : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/me/bookings/${bookingId}/pay`}
          className="font-ar flex-1 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-center text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/25"
        >
          {clientsAr.payNow}
        </Link>
        {activeCheckoutId ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isChecking}
            className="font-ar rounded-lg border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-primary transition-colors hover:bg-navy-secondary disabled:opacity-60"
          >
            {isChecking
              ? clientsAr.paymentResultChecking
              : clientsAr.paymentRefreshStatus}
          </button>
        ) : null}
      </div>
    </div>
  );
}
