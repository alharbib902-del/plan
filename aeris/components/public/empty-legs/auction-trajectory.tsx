import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { formatSarAmount } from '@/components/admin/empty-legs/formatters';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

/**
 * Phase 7 PR 2d — Dutch-auction trajectory visualization
 * for the public detail page. Renders a tiny inline
 * summary ("سيصل إلى X ريال خلال Y ساعة") rather than
 * a full SVG curve — the spec keeps the public detail
 * page readable on mobile.
 *
 * The full curve chart (admin trajectory chart, §7.3
 * Case 1) is admin-only territory and lives elsewhere.
 */
export function PublicAuctionTrajectory({ leg }: { leg: EmptyLegRow }) {
  if (
    leg.original_price === null ||
    leg.auction_floor_discount_pct === null ||
    leg.auction_window_end_at === null
  ) {
    return null;
  }

  const floorPrice = Math.round(
    leg.original_price * (1 - leg.auction_floor_discount_pct / 100)
  );

  const windowEndMs = Date.parse(leg.auction_window_end_at);
  const remainingMs = windowEndMs - Date.now();
  const remainingHours = Math.max(0, Math.round(remainingMs / 3_600_000));

  const reachedFloor =
    leg.current_discount_pct !== null &&
    leg.current_discount_pct >= leg.auction_floor_discount_pct;

  return (
    <section className="rounded-xl border border-border bg-navy-secondary/40 p-4">
      <h2 className="font-ar text-sm uppercase tracking-tagged text-ink-muted">
        {emptyLegsAr.publicAuctionTrajectoryTitle}
      </h2>
      <p className="font-ar mt-2 text-sm text-ink">
        {reachedFloor
          ? emptyLegsAr.publicAuctionFloorReached
          : emptyLegsAr.publicAuctionWillReachIn
              .replace('{floor}', formatSarAmount(floorPrice))
              .replace('{hours}', String(remainingHours))}
      </p>
      <p className="font-ar mt-3 text-xs text-ink-muted">
        {emptyLegsAr.publicAuctionTrajectoryHint.replace(
          '{floor}',
          formatSarAmount(floorPrice)
        )}
      </p>
    </section>
  );
}
