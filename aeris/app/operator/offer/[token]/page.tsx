import type { Metadata } from 'next';
import { verifyOperatorToken } from '@/lib/operator/token';
import { getTripById } from '@/lib/supabase/queries/trips';
import { getTargetById } from '@/lib/supabase/queries/phase5-targets';
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

/**
 * Operator portal — single route, two token versions.
 *
 * After `verifyOperatorToken` confirms HMAC + expiry + payload
 * shape, this page branches strictly by `verified.version`
 * (single-pass verifier; no fallback). Both branches do a
 * server-side state re-check against the database before
 * rendering the form, so a re-dispatch / accept / cancel that
 * landed since the token was issued shows the friendly
 * ExpiredLink page instead of a doomed submit form.
 *
 *   v=1 → Phase 4: trip-level dispatch_nonce + dispatch_expires_at.
 *         (Backwards-compat for any pre-Phase-5 link still in the
 *         wild.)
 *   v=2 → Phase 5: per-target row in trip_dispatch_targets, plus
 *         a check that the target's round is still the trip's
 *         current_dispatch_round_id (re-dispatch invalidates the
 *         entire prior round's targets at the SQL level; this
 *         page mirrors that for the visible flow).
 *
 * The submit RPCs re-verify all of this under FOR UPDATE on
 * insert, so this page's checks are necessary but never
 * sufficient.
 */
export default async function OperatorOfferPage({
  params,
}: OperatorOfferPageProps) {
  const verified = verifyOperatorToken(params.token);
  if (!verified.valid) {
    return <ExpiredLink />;
  }

  // ──────────────────────────────────────────────────────────
  // v=1 (Phase 4) — trip-level dispatch state
  // ──────────────────────────────────────────────────────────
  if (verified.version === 1) {
    const trip = await getTripById(verified.payload.trip_request_id);
    if (!trip) {
      return <ExpiredLink />;
    }

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

  // ──────────────────────────────────────────────────────────
  // v=2 (Phase 5) — per-target row state
  // ──────────────────────────────────────────────────────────
  // verified.version === 2; payload carries trip_request_id +
  // dispatch_target_id + nonce + expires_at (issued_at).
  const [trip, target] = await Promise.all([
    getTripById(verified.payload.trip_request_id),
    getTargetById(verified.payload.dispatch_target_id),
  ]);

  if (!trip || !target) {
    return <ExpiredLink />;
  }

  // Belt-and-suspenders: the HMAC verifier already proved the
  // payload (and its nonce) wasn't tampered with. The DB
  // re-check below catches the cases the HMAC can't catch:
  //   - target row was cancelled (admin re-dispatched or
  //     accepted a sibling)
  //   - target row was already submitted (one offer per
  //     target — UNIQUE constraint backstops this on the RPC
  //     path too)
  //   - re-dispatch happened, so target.dispatch_round_id no
  //     longer equals trip.current_dispatch_round_id
  //   - trip was booked or cancelled
  const nonceMatches = target.nonce === verified.payload.nonce;
  const targetActive = target.status === 'pending';
  const targetAlive = Date.parse(target.expires_at) > Date.now();
  const roundCurrent =
    trip.current_dispatch_round_id !== null &&
    target.dispatch_round_id === trip.current_dispatch_round_id;
  const tripOpen = trip.status !== 'booked' && trip.status !== 'cancelled';

  if (!nonceMatches || !targetActive || !targetAlive || !roundCurrent || !tripOpen) {
    return <ExpiredLink />;
  }

  return (
    <div className="space-y-6">
      <OperatorTripSummary trip={trip} />
      <OperatorOfferForm token={params.token} />
    </div>
  );
}
