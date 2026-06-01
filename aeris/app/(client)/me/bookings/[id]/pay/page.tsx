import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { getBookingForClient } from '@/lib/clients/queries/me-bookings';
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

      <CheckoutClient bookingId={id} />
    </section>
  );
}
