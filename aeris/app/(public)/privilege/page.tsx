import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TierBadge } from '@/components/privilege/tier-badge';
import { privilegeAr } from '@/lib/i18n/privilege-ar';
import { readPublicTierThresholds } from '@/lib/privilege/client-pii';
import type { ClientPrivilegeTier } from '@/lib/privilege/types';

/**
 * Phase 13 PR 2 — public marketing /privilege page.
 *
 * Renders the 4-tier comparison table from privilege_tier_thresholds.
 * Anonymous + authenticated visitors both see the same content.
 *
 * Gated behind ENABLE_PRIVILEGE so the page is invisible until the
 * feature flag flips on production.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: privilegeAr.publicTitle,
  description: privilegeAr.publicSubtitle,
};

function formatSar(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' ريال';
}

export default async function PublicPrivilegePage() {
  if (process.env.ENABLE_PRIVILEGE !== 'true') notFound();

  const thresholds = await readPublicTierThresholds();

  return (
    <div className="relative bg-navy">
      <section className="mx-auto max-w-6xl space-y-12 px-4 pb-24 pt-32 sm:px-6 lg:px-8">
        <header className="space-y-4 text-center">
          <span className="font-ar inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold">
            {privilegeAr.programName}
          </span>
          <h1 className="font-ar text-3xl leading-tight text-ink-primary sm:text-4xl md:text-5xl">
            {privilegeAr.publicTitle}
          </h1>
          <p className="font-ar mx-auto max-w-2xl text-base leading-7 text-ink-secondary">
            {privilegeAr.publicSubtitle}
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {thresholds.map((t) => (
            <div
              key={t.tier}
              className="flex flex-col gap-4 rounded-2xl border border-navy-card bg-navy-card/40 p-6"
            >
              <div className="flex items-center justify-between">
                <TierBadge tier={t.tier as ClientPrivilegeTier} size="lg" />
                <span className="font-ar text-2xl text-gold">
                  {t.cashback_pct}%
                </span>
              </div>
              <div>
                <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
                  {privilegeAr.kpiAnnualSpend}
                </p>
                <p className="font-ar mt-1 text-lg text-ink-primary">
                  {Number(t.min_qualified_spend_sar) === 0
                    ? 'من ٠'
                    : `من ${formatSar(t.min_qualified_spend_sar)}`}
                </p>
              </div>
              <div>
                <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
                  {privilegeAr.kpiEmptyLegsWindow}
                </p>
                <p className="font-ar mt-1 text-sm text-ink-primary">
                  {t.empty_legs_boost_hours === 0
                    ? 'عادي'
                    : `أبكر ${t.empty_legs_boost_hours} ساعة`}
                </p>
              </div>
              {/* 2026-06 scope focus — the Shield perk is a MedEvac benefit;
                  with the vertical hidden the public tier card must not
                  advertise it. Restored automatically when the flag flips. */}
              {t.free_diamond_shield && process.env.ENABLE_MEDEVAC === 'true' && (
                <p className="font-ar mt-2 text-xs text-violet-300">
                  + Aeris Shield Diamond مجاناً (MedEvac unlimited)
                </p>
              )}
              {t.two_factor_required && (
                <p className="font-ar mt-1 text-xs text-amber-300">
                  + المصادقة الثنائية موصى بها
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3 rounded-2xl border border-navy-card bg-navy-card/40 p-6">
          <h2 className="font-ar text-lg text-ink-primary">كيف يعمل البرنامج</h2>
          <ul className="font-ar space-y-2 text-sm text-ink-secondary">
            <li>• {privilegeAr.noteIndependentSilver}</li>
            <li>• {privilegeAr.noteUpgradeImmediate}</li>
            <li>• {privilegeAr.noteDowngradeGrace}</li>
            <li>• {privilegeAr.noteCashbackExpiry}</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
