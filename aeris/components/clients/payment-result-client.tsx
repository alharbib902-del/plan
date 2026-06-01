'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { confirmCheckout } from '@/app/actions/payments';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { ClientBanner, clientErrorMessage } from './error-banner';

/**
 * Phase payments PR #120 — settles the payment after the gateway redirect.
 * Calls confirmCheckout once on mount (server-side status lookup is the source
 * of truth; idempotent + ownership-checked in the action). Shows
 * success / pending / failed with the right next step.
 */

type ResultState = 'checking' | 'success' | 'pending' | 'failed';

export function PaymentResultClient({
  bookingId,
  checkoutId,
}: {
  bookingId: string;
  checkoutId: string | null;
}) {
  const [state, setState] = useState<ResultState>(
    checkoutId ? 'checking' : 'failed'
  );
  const [error, setError] = useState<string | null>(
    checkoutId ? null : 'payment_not_found'
  );
  const ran = useRef(false);

  useEffect(() => {
    if (!checkoutId || ran.current) return;
    ran.current = true;
    void (async () => {
      const result = await confirmCheckout({
        checkout_id: checkoutId,
        expected_booking_id: bookingId,
      });
      if (!result.ok) {
        setError(result.error);
        setState('failed');
        return;
      }
      setState(result.outcome === 'success' ? 'success' : 'pending');
    })();
  }, [checkoutId, bookingId]);

  const backLink = (
    <Link
      href={`/me/bookings/${bookingId}`}
      className="font-ar inline-block rounded-lg border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-primary transition-colors hover:bg-navy-secondary"
    >
      {clientsAr.paymentBackToBooking}
    </Link>
  );

  if (state === 'checking') {
    return (
      <div className="rounded-xl border border-border bg-navy-card/40 p-6">
        <p className="font-ar text-sm text-ink-muted">
          {clientsAr.paymentResultChecking}
        </p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-6">
        <ClientBanner kind="success">
          <strong>{clientsAr.paymentSuccessTitle}</strong> —{' '}
          {clientsAr.paymentSuccessBody}
        </ClientBanner>
        {backLink}
      </div>
    );
  }

  if (state === 'pending') {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-6">
        <ClientBanner kind="info">
          <strong>{clientsAr.paymentPendingTitle}</strong> —{' '}
          {clientsAr.paymentPendingBody}
        </ClientBanner>
        {backLink}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-6">
      <ClientBanner kind="error">
        <strong>{clientsAr.paymentFailedTitle}</strong> —{' '}
        {clientErrorMessage(error ?? 'payment_failed')}
      </ClientBanner>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/me/bookings/${bookingId}/pay`}
          className="font-ar inline-block rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/25"
        >
          {clientsAr.paymentRetry}
        </Link>
        {backLink}
      </div>
    </div>
  );
}
