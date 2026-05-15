import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 10 PR 2 — `source_discriminator` chip for /me/bookings.
 *
 * The unified bookings list (Decision #10) shows BOTH charter
 * bookings AND empty-leg bookings (post-admin-confirmation) on
 * the same page. This chip disambiguates the row source:
 *   - 'charter' → "طيران خاص" (gold tone — Phase 9 default)
 *   - 'empty_leg' → "رحلة فارغة" (sky tone — Phase 10 marker)
 *
 * Server-rendered. No interactivity.
 */

interface BookingsSourceChipProps {
  source: 'charter' | 'empty_leg';
}

export function BookingsSourceChip({ source }: BookingsSourceChipProps) {
  if (source === 'empty_leg') {
    return (
      <span className="font-ar inline-flex items-center rounded-full border border-sky-400/40 bg-sky-500/10 px-2.5 py-0.5 text-xs text-sky-100">
        {clientsAr.bookingsSourceEmptyLeg}
      </span>
    );
  }
  return (
    <span className="font-ar inline-flex items-center rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs text-gold-light">
      {clientsAr.bookingsSourceCharter}
    </span>
  );
}
