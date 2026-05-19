import { privilegeAr } from '@/lib/i18n/privilege-ar';
import type { ClientPrivilegeTier } from '@/lib/privilege/types';

/**
 * Phase 13 PR 1 — Tier badge component.
 *
 * Visual palette per spec §1 J3 + D-spec choices:
 *   silver   → slate (neutral, base)
 *   gold     → amber/gold (matches brand gold)
 *   platinum → cyan (cooler than gold, distinct)
 *   diamond  → violet (rare/premium)
 *
 * Differentiates from other product chips:
 *   - charter → gold
 *   - empty legs → emerald
 *   - cargo → slate
 *   - medevac → rose
 *   - privilege → varies per tier above
 */

const TIER_STYLES: Record<ClientPrivilegeTier, string> = {
  silver:
    'bg-slate-500/10 text-slate-300 border-slate-500/30 ' +
    'dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/40',
  gold:
    'bg-amber-500/10 text-amber-700 border-amber-500/30 ' +
    'dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40',
  platinum:
    'bg-cyan-500/10 text-cyan-700 border-cyan-500/30 ' +
    'dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/40',
  diamond:
    'bg-violet-500/10 text-violet-700 border-violet-500/30 ' +
    'dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/40',
};

export function TierBadge({
  tier,
  size = 'md',
}: {
  tier: ClientPrivilegeTier;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeClass =
    size === 'sm'
      ? 'px-2 py-0.5 text-xs'
      : size === 'lg'
      ? 'px-4 py-1.5 text-sm'
      : 'px-3 py-1 text-xs';

  return (
    <span
      className={`font-ar inline-flex items-center rounded-full border ${sizeClass} ${TIER_STYLES[tier]}`}
    >
      {privilegeAr.tier[tier]}
    </span>
  );
}
