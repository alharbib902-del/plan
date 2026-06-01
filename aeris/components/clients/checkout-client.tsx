'use client';

import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

import { startCheckout } from '@/app/actions/payments';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { ClientBanner, clientErrorMessage } from './error-banner';
import { formatSARLabel } from './offer-format';

/**
 * Phase payments PR #120 — mounts the HyperPay COPYandPAY hosted widget.
 *
 * On mount it calls startCheckout (idempotent per booking — a re-entry reuses
 * the active attempt + its checkout), then injects the gateway's
 * paymentWidgets.js and the `.paymentWidgets` form. The form `action` is OUR
 * same-origin result page; HyperPay redirects there with `?id=<checkoutId>`
 * after payment, where confirmCheckout settles it via a server-side status
 * lookup. No card data ever touches our servers (hosted widget, PCI SAQ-A).
 */

type Widget = {
  scriptUrl: string;
  brands: string[];
  amount: number;
};

export function CheckoutClient({ bookingId }: { bookingId: string }) {
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>(
    'starting'
  );
  const [error, setError] = useState<string | null>(null);
  const [widget, setWidget] = useState<Widget | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const result = await startCheckout({
        booking_id: bookingId,
        idempotency_key: crypto.randomUUID(),
      });
      if (!result.ok) {
        setError(result.error);
        setStatus('error');
        return;
      }
      setWidget({
        scriptUrl: result.widget.scriptUrl,
        brands: result.widget.brands,
        amount: result.amount,
      });
      setStatus('ready');
    })();
  }, [bookingId]);

  if (status === 'starting') {
    return (
      <div className="rounded-xl border border-border bg-navy-card/40 p-6">
        <p className="font-ar text-sm text-ink-muted">
          {clientsAr.paymentStarting}
        </p>
      </div>
    );
  }

  if (status === 'error' || !widget) {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-6">
        <ClientBanner kind="error">
          {clientErrorMessage(error ?? 'rpc_failed')}
        </ClientBanner>
        <Link
          href={`/me/bookings/${bookingId}`}
          className="font-ar inline-block rounded-lg border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-primary transition-colors hover:bg-navy-secondary"
        >
          {clientsAr.paymentBackToBooking}
        </Link>
      </div>
    );
  }

  // Client-only (status flips to 'ready' from a client effect) → window is safe.
  const resultUrl = `${window.location.origin}/me/bookings/${bookingId}/pay/result`;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-6">
      <div className="flex items-baseline justify-between">
        <span className="font-ar text-sm text-ink-muted">
          {clientsAr.paymentAmountLabel}
        </span>
        <span className="font-ar text-lg text-gold-light">
          {formatSARLabel(widget.amount)}
        </span>
      </div>
      <p className="font-ar text-xs text-ink-muted">
        {clientsAr.paymentSecureNote}
      </p>

      <Script src={widget.scriptUrl} strategy="afterInteractive" />
      <form
        action={resultUrl}
        className="paymentWidgets"
        data-brands={widget.brands.join(' ')}
      />
    </div>
  );
}
