import type { Metadata } from 'next';

import { OperatorOfferForm } from '@/components/operator/offer-form';
import { ExpiredLink, type ExpiredReason } from '@/components/operator/expired-link';
import {
  OperatorTripSummary,
  type OperatorContext,
} from '@/components/operator/trip-summary';
import { parseLang } from '@/lib/i18n/operator';
import { verifyOperatorToken } from '@/lib/operator/token';
import { listAirports } from '@/lib/supabase/queries/airports';
import { getTargetById } from '@/lib/supabase/queries/phase5-targets';
import { getTripById } from '@/lib/supabase/queries/trips';
// Phase 6.2 PR 2b S6: best-effort fetch of attached add-ons
// for the trip-summary's read-only "الخدمات الإضافية"
// section. Returns [] when the trip has no bookings row yet
// (pre-PR-2a-accept), and the trip-summary then skips the
// section. Full visibility for the chosen operator post-
// accept depends on a future relaxation of the gate logic;
// the component is ready for it.
import {
  getBookingByTripId,
  listBookingAddons,
} from '@/lib/supabase/queries/bookings';
import type { BookingAddonRow } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تقديم عرض',
  robots: { index: false, follow: false },
};

interface OperatorOfferPageProps {
  params: { token: string };
  searchParams?: { lang?: string | string[] };
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
 * Phase 5.1 (S2): when the page already knows the failure cause
 * (state-fail on a HMAC-VALID token), it threads a `reason` prop
 * to ExpiredLink so the friendly page can show a more specific
 * body. **HMAC-fail (the early-return at line `verified.valid`
 * check) MUST NOT pass a reason** — that branch stays generic to
 * preserve the no-oracle property documented in the Phase 5
 * activation entry.
 *
 * The submit RPCs re-verify all of this under FOR UPDATE on
 * insert, so this page's checks are necessary but never
 * sufficient.
 */
export default async function OperatorOfferPage({
  params,
  searchParams,
}: OperatorOfferPageProps) {
  const lang = parseLang(searchParams?.lang);

  const verified = verifyOperatorToken(params.token);
  if (!verified.valid) {
    // HMAC-fail / shape-fail / expiry-from-payload-fail.
    // Do NOT pass `reason` — see Phase 5 activation entry's
    // "Tampered v=2 token rejection" note: probing an enumerated
    // link must give no oracle.
    return <ExpiredLink lang={lang} />;
  }

  const tokenExpiresAtIso = new Date(
    verified.payload.expires_at * 1000
  ).toISOString();
  const operatorContext: OperatorContext = {
    tokenExpiresAt: tokenExpiresAtIso,
    tokenVersion: verified.version,
  };

  // ──────────────────────────────────────────────────────────
  // v=1 (Phase 4) — trip-level dispatch state
  // ──────────────────────────────────────────────────────────
  if (verified.version === 1) {
    // Phase 6.0 PR 2 (S6): fetch airports in parallel with the
    // trip read so the operator-portal trip summary can render
    // the airport label per the 3-shape contract without a
    // round-trip per leg.
    const [trip, airports] = await Promise.all([
      getTripById(verified.payload.trip_request_id),
      listAirports({ privateCapable: true }),
    ]);
    if (!trip) {
      return <ExpiredLink lang={lang} />;
    }

    const dispatchAlive =
      trip.dispatch_expires_at !== null &&
      Date.parse(trip.dispatch_expires_at) > Date.now();
    const nonceMatches =
      trip.dispatch_nonce !== null &&
      trip.dispatch_nonce === verified.payload.nonce;
    const tripOpen = trip.status !== 'booked' && trip.status !== 'cancelled';

    if (!dispatchAlive || !nonceMatches || !tripOpen) {
      // v=1 reason is best-effort. The trip-level signals don't
      // carry per-target precision, but the most common causes
      // map cleanly:
      //   - dispatch expired           → link_expired
      //   - nonce no longer matches    → link_cancelled (re-dispatch)
      //   - trip booked / cancelled    → link_already_used
      const reason: ExpiredReason = !dispatchAlive
        ? 'link_expired'
        : !nonceMatches
          ? 'link_cancelled'
          : 'link_already_used';
      return <ExpiredLink reason={reason} lang={lang} />;
    }

    const v1Addons = await fetchTripAddons(trip.id);

    return (
      <div className="space-y-6">
        <OperatorTripSummary
          trip={trip}
          operatorContext={operatorContext}
          airports={airports}
          lang={lang}
          addons={v1Addons}
        />
        <OperatorOfferForm
          token={params.token}
          tripRequestNumber={trip.request_number}
          lang={lang}
        />
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────
  // v=2 (Phase 5) — per-target row state
  // ──────────────────────────────────────────────────────────
  // verified.version === 2; payload carries trip_request_id +
  // dispatch_target_id + nonce + expires_at (issued_at).
  // Airports fetched in parallel for the trip-summary's
  // 3-shape airportLabel rendering (Phase 6.0 PR 2 S6).
  const [trip, target, airports] = await Promise.all([
    getTripById(verified.payload.trip_request_id),
    getTargetById(verified.payload.dispatch_target_id),
    listAirports({ privateCapable: true }),
  ]);

  if (!trip || !target) {
    return <ExpiredLink lang={lang} />;
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
  const targetAlive = Date.parse(target.expires_at) > Date.now();
  const targetStatus = target.status;
  const roundCurrent =
    trip.current_dispatch_round_id !== null &&
    target.dispatch_round_id === trip.current_dispatch_round_id;
  const nonceMatches = target.nonce === verified.payload.nonce;
  const tripOpen = trip.status !== 'booked' && trip.status !== 'cancelled';

  if (
    !nonceMatches ||
    targetStatus !== 'pending' ||
    !targetAlive ||
    !roundCurrent ||
    !tripOpen
  ) {
    // v=2 has the per-target row, so the reason is precise.
    // Order matches the user's mental model: "is the link
    // expired? was it cancelled? was it already used?".
    const reason: ExpiredReason = !targetAlive
      ? 'link_expired'
      : targetStatus === 'submitted'
        ? 'link_already_used'
        : targetStatus === 'cancelled' || !roundCurrent || !nonceMatches
          ? 'link_cancelled'
          : 'link_already_used'; // tripOpen=false fallback (booked/cancelled)
    return <ExpiredLink reason={reason} lang={lang} />;
  }

  const v2Addons = await fetchTripAddons(trip.id);

  return (
    <div className="space-y-6">
      <OperatorTripSummary
        trip={trip}
        operatorContext={operatorContext}
        airports={airports}
        lang={lang}
        addons={v2Addons}
      />
      <OperatorOfferForm
        token={params.token}
        tripRequestNumber={trip.request_number}
        lang={lang}
      />
    </div>
  );
}

/**
 * Phase 6.2 PR 2b S6: best-effort fetch of attached add-ons
 * for a given trip. Returns [] when no bookings row exists
 * for the trip (pre-PR-2a-accept legacy or pre-accept
 * pending). The trip-summary component skips the section
 * entirely when the array is empty.
 *
 * This is wrapped in a try/catch so a transient DB error
 * during this read does NOT break the operator portal page
 * — the operator can still see the trip-summary + submit
 * the offer.
 */
async function fetchTripAddons(tripId: string): Promise<BookingAddonRow[]> {
  try {
    const booking = await getBookingByTripId(tripId);
    if (!booking) return [];
    return await listBookingAddons(booking.id);
  } catch (err) {
    console.error('[operator-portal.fetchTripAddons]', err);
    return [];
  }
}
