import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { getBookingForClient } from '@/lib/clients/queries/me-bookings';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { PaymentResultClient } from '@/components/clients/payment-result-client';

/**
 * Phase payments PR #120 — payment result page. HyperPay redirects the browser
 * here after the hosted widget completes, appending `?id=<checkoutId>`.
 * Confirmation runs client-side via confirmCheckout (server-side status lookup,
 * idempotent + ownership-checked). Guards: portal + ENABLE_PAYMENTS + ownership.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.paymentCheckoutHeading,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ id?: string | string[] }>;
}

export default async function ClientPaymentResultPage({
  params,
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  if (process.env.ENABLE_PAYMENTS !== 'true') notFound();

  const { id } = await params;
  const sp = await searchParams;
  const rawId = sp.id;
  const checkoutId =
    typeof rawId === 'string'
      ? rawId
      : Array.isArray(rawId)
        ? (rawId[0] ?? undefined)
        : undefined;

  const session = await requireClientSession();
  const booking = await getBookingForClient(session.client_id, id);
  if (!booking) notFound();

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

      <PaymentResultClient bookingId={id} checkoutId={checkoutId ?? null} />
    </section>
  );
}
