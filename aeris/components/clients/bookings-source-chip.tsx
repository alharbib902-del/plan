import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 10 PR 2 + Phase 11 PR 1 — `source_discriminator` chip
 * for /me/bookings.
 *
 * The unified bookings list (Phase 10 Decision #10) renders 3
 * source variants on the same page:
 *   - 'charter' → "طيران خاص" (gold tone — Phase 9 default)
 *   - 'empty_leg' → "رحلة فارغة" (sky tone — Phase 10 marker)
 *   - 'cargo' → "شحن" (emerald tone — Phase 11 marker)
 *
 * Phase 11 PR 1 adds the 'cargo' branch (DB-side bookings can
 * carry source_discriminator='cargo' once §3.4.1 + §4.4
 * accept_cargo_offer ship; this chip is the consumer side).
 * The /me/bookings page has no Phase 11 cargo bookings until
 * PR 2 ships accept_cargo_offer + the authed portal flow, so
 * the cargo branch stays inert in production until then.
 *
 * Server-rendered. No interactivity.
 */

interface BookingsSourceChipProps {
  source: 'charter' | 'empty_leg' | 'cargo';
}

export function BookingsSourceChip({ source }: BookingsSourceChipProps) {
  if (source === 'empty_leg') {
    return (
      <span className="font-ar inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-100">
        {clientsAr.bookingsSourceEmptyLeg}
      </span>
    );
  }
  if (source === 'cargo') {
    return (
      <span className="font-ar inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-100">
        {clientsAr.bookingsSourceCargo}
      </span>
    );
  }
  return (
    <span className="font-ar inline-flex items-center rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs text-gold-light">
      {clientsAr.bookingsSourceCharter}
    </span>
  );
}
