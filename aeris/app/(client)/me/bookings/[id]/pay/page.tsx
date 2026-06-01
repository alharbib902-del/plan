import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import {
  getBookingForClient,
  bookingHasActivePaymentAttempt,
} from '@/lib/clients/queries/me-bookings';
import { loadAcceptCashbackContext } from '@/lib/privilege/accept-context';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { CheckoutClient } from '@/components/clients/checkout-client';

/**
 * Phase payments PR #120 — client checkout page. Guards (fail-closed): client
 * portal + ENABLE_PAYMENTS + session ownership + the booking must still be
 * payable (pending_offline). The actual gateway checkout is started + mounted
 * client-side in CheckoutClient (HyperPay COPYandPAY hosted widget).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.paymentCheckoutHeading,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientCheckoutPage({ params }: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  if (process.env.ENABLE_PAYMENTS !== 'true') notFound();

  const { id } = await params;
  const session = await requireClientSession();
  const booking = await getBookingForClient(session.client_id, id);

  if (!booking) notFound();
  // Already paid / not payable → back to the booking (no double charge).
  if (booking.payment_status !== 'pending_offline') {
    redirect(`/me/bookings/${id}`);
  }

  // Cashback-at-checkout (PR #121): the redeem input shows only when privilege
  // is on + the client has a balance. `alreadyRedeemedSar` (from the booking)
  // means a redemption is locked for this booking → the input is read-only.
  const cashback = await loadAcceptCashbackContext(session.client_id);
  const total = Number(booking.total_amount ?? 0);
  // cashback_redemption_sar is not in the hand-maintained BookingRow type
  // (loose-client pattern) — present at runtime via select('*').
  const alreadyRedeemed = Number(
    (booking as { cashback_redemption_sar?: number | string | null })
      .cashback_redemption_sar ?? 0
  );
  // An active attempt freezes redemption → lock the input (no misleading net).
  const paymentLocked = await bookingHasActivePaymentAttempt(id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.paymentCheckoutHeading}
        </h1>
        <p dir="ltr" className="font-ar mt-1 text-sm text-ink-muted">
          {booking.booking_number}
        </p>
      </header>

      <CheckoutClient
        bookingId={id}
        bookingTotalSar={total}
        cashbackEnabled={cashback.enabled}
        cashbackBalanceSar={cashback.cashback_balance_sar}
        alreadyRedeemedSar={alreadyRedeemed}
        paymentLocked={paymentLocked}
      />
    </section>
  );
}
