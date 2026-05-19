/**
 * Phase 13 PR 2 — Progress bar for /me/privilege.
 *
 * Shows progress fraction (0-1) from one tier to the next as a
 * horizontal gold-filled bar. Pure presentational.
 */

export function TierProgressBar({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-navy-card">
      <div
        className="h-full rounded-full bg-gradient-to-r from-gold-dark via-gold to-gold-light transition-all"
        style={{ width: `${pct.toFixed(1)}%` }}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        role="progressbar"
      />
    </div>
  );
}
