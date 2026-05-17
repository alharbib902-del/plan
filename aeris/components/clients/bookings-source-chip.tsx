import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 10 PR 2 + Phase 11 PR 1 + Phase 12 PR 2 round 1
 * PR #77 P2 #2 fix — `source_discriminator` chip for
 * /me/bookings.
 *
 * The unified bookings list (Phase 10 Decision #10) renders 4
 * source variants on the same page:
 *   - 'charter'   → "طيران خاص" (gold tone — Phase 9 default)
 *   - 'empty_leg' → "رحلة فارغة" (sky tone — Phase 10 marker)
 *   - 'cargo'     → "شحن" (emerald tone — Phase 11 marker)
 *   - 'medevac'   → "إخلاء طبي" (rose tone — Phase 12 marker
 *                   per spec Probe 36 lock; rose is the
 *                   medical-urgent palette chosen to
 *                   differentiate from charter/empty-leg/cargo)
 *
 * The DB side now writes 'medevac' via §4.4 accept_medevac_offer
 * (PR 2 migration) AND §4.7 consume_aeris_shield_event (PR 1
 * Shield covered path, hotfixed in PR 2 to use the real
 * booking shape). Without this chip branch the bookings table
 * would fall through to the gold "طيران خاص" default for
 * medevac rows.
 *
 * Server-rendered. No interactivity.
 */

interface BookingsSourceChipProps {
  source: 'charter' | 'empty_leg' | 'cargo' | 'medevac';
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
  if (source === 'medevac') {
    return (
      <span className="font-ar inline-flex items-center rounded-full border border-rose-400/40 bg-rose-500/10 px-2.5 py-0.5 text-xs text-rose-100">
        {clientsAr.bookingsSourceMedevac}
      </span>
    );
  }
  return (
    <span className="font-ar inline-flex items-center rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs text-gold-light">
      {clientsAr.bookingsSourceCharter}
    </span>
  );
}
