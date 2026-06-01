'use client';

import Script from 'next/script';
import { useState } from 'react';

import { startCheckout } from '@/app/actions/payments';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { CashbackRedeemInput } from '@/components/privilege/cashback-redeem-input';
import { ClientBanner, clientErrorMessage } from './error-banner';
import { formatSARLabel } from './offer-format';

/**
 * Phase payments PR #120 + #121 — compose → pay checkout.
 *
 * Step 1 (compose): review the amount, optionally redeem cashback (must happen
 * BEFORE payment), then "تابع للدفع".
 * Step 2 (pay): startCheckout (idempotent per booking; the action redeems then
 * derives the net) → mount the HyperPay COPYandPAY hosted widget. HyperPay
 * redirects to our same-origin result page (?id=<checkoutId>) where
 * confirmCheckout settles via a server-side status lookup. No card data ever
 * touches our servers (hosted widget, PCI SAQ-A).
 *
 * Redemption is once-per-booking and frozen once an attempt exists: when
 * `alreadyRedeemedSar > 0` the redeem input is locked (read-only) and the new
 * redemption is NOT re-sent (the booking already carries it).
 */

type Widget = {
  scriptUrl: string;
  brands: string[];
  amount: number;
};

type Phase = 'compose' | 'starting' | 'ready';

export function CheckoutClient({
  bookingId,
  bookingTotalSar,
  cashbackEnabled,
  cashbackBalanceSar,
  alreadyRedeemedSar,
}: {
  bookingId: string;
  bookingTotalSar: number;
  cashbackEnabled: boolean;
  cashbackBalanceSar: number;
  alreadyRedeemedSar: number;
}) {
  const [phase, setPhase] = useState<Phase>('compose');
  const [error, setError] = useState<string | null>(null);
  const [widget, setWidget] = useState<Widget | null>(null);
  const [redemption, setRedemption] = useState<number>(0);

  const locked = alreadyRedeemedSar > 0;
  const effectiveRedemption = locked ? alreadyRedeemedSar : redemption;
  const netPreview = Math.max(0, bookingTotalSar - effectiveRedemption);
  const showRedeemInput = !locked && cashbackEnabled && cashbackBalanceSar > 0;

  const onProceed = () => {
    setError(null);
    setPhase('starting');
    void (async () => {
      const result = await startCheckout({
        booking_id: bookingId,
        idempotency_key: crypto.randomUUID(),
        // Only send a NEW redemption; a locked one already sits on the booking.
        ...(!locked && redemption > 0
          ? { cashback_redemption_sar: redemption }
          : {}),
      });
      if (!result.ok) {
        setError(result.error);
        setPhase('compose');
        return;
      }
      setWidget({
        scriptUrl: result.widget.scriptUrl,
        brands: result.widget.brands,
        amount: result.amount,
      });
      setPhase('ready');
    })();
  };

  if (phase === 'ready' && widget) {
    // Client-only (set from a click handler) → window is safe.
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

  const busy = phase === 'starting';
  return (
    <div className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-6">
      <div className="flex items-baseline justify-between">
        <span className="font-ar text-sm text-ink-muted">
          {clientsAr.paymentAmountLabel}
        </span>
        <span className="font-ar text-lg text-gold-light">
          {formatSARLabel(netPreview)}
        </span>
      </div>
      {effectiveRedemption > 0 ? (
        <p className="font-ar text-xs text-ink-muted">
          {clientsAr.paymentRedeemAppliedLabel}:{' '}
          {formatSARLabel(effectiveRedemption)} ·{' '}
          {clientsAr.bookingDetailTotalLabel}: {formatSARLabel(bookingTotalSar)}
        </p>
      ) : null}

      {showRedeemInput ? (
        <CashbackRedeemInput
          bookingTotalSar={bookingTotalSar}
          currentBalanceSar={cashbackBalanceSar}
          value={redemption}
          onChange={setRedemption}
          disabled={busy}
        />
      ) : null}

      <p className="font-ar text-xs text-ink-muted">
        {clientsAr.paymentSecureNote}
      </p>

      {error ? (
        <ClientBanner kind="error">{clientErrorMessage(error)}</ClientBanner>
      ) : null}

      <button
        type="button"
        onClick={onProceed}
        disabled={busy}
        className="font-ar w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:opacity-60"
      >
        {busy ? clientsAr.paymentStarting : clientsAr.paymentProceed}
      </button>
    </div>
  );
}
