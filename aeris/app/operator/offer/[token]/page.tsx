import type { Metadata } from 'next';
import { verifyOperatorToken } from '@/lib/operator/token';
import { getTripById } from '@/lib/supabase/queries/trips';
import { OperatorTripSummary } from '@/components/operator/trip-summary';
import { OperatorOfferForm } from '@/components/operator/offer-form';
import { ExpiredLink } from '@/components/operator/expired-link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تقديم عرض',
  robots: { index: false, follow: false },
};

interface OperatorOfferPageProps {
  params: { token: string };
}

export default async function OperatorOfferPage({
  params,
}: OperatorOfferPageProps) {
  const verified = verifyOperatorToken(params.token);
  if (!verified.valid) {
    return <ExpiredLink />;
  }

  const trip = await getTripById(verified.payload.trip_request_id);
  if (!trip) {
    return <ExpiredLink />;
  }

  // Re-check dispatch state at request time. The RPC re-checks it
  // again under FOR UPDATE on submit, but failing fast here avoids
  // showing the form for an already-invalid link.
  const nonceMatches =
    trip.dispatch_nonce !== null &&
    trip.dispatch_nonce === verified.payload.nonce;
  const dispatchAlive =
    trip.dispatch_expires_at !== null &&
    Date.parse(trip.dispatch_expires_at) > Date.now();
  const tripOpen = trip.status !== 'booked' && trip.status !== 'cancelled';

  if (!nonceMatches || !dispatchAlive || !tripOpen) {
    return <ExpiredLink />;
  }

  return (
    <div className="space-y-6">
      <OperatorTripSummary trip={trip} />
      <OperatorOfferForm token={params.token} />
    </div>
  );
}
