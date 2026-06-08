import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TierBadge } from '@/components/privilege/tier-badge';
import { TierProgressBar } from '@/components/privilege/tier-progress-bar';
import { privilegeAr } from '@/lib/i18n/privilege-ar';
import { readClientPrivilegeDashboard } from '@/lib/privilege/client-pii';
import {
  progressToNextTier,
  spendRemainingToNextTier,
  stepUpOne,
  TIER_CASHBACK_PCT,
} from '@/lib/privilege/tier-helpers';

/**
 * Phase 13 PR 2 — /me/privilege dashboard.
 *
 * Read-only client view of own tier + balance + spend window +
 * progress to next tier + recent ledger + recent change_log.
 * Gated behind ENABLE_PRIVILEGE; requires authed client session
 * (helper redirects to /login if absent).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: privilegeAr.programName,
  robots: { index: false, follow: false },
};

function formatSar(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ريال';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-GB', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return value;
  }
}

export default async function MePrivilegePage() {
  if (process.env.ENABLE_PRIVILEGE !== 'true') notFound();

  const dashboard = await readClientPrivilegeDashboard();
  const { full_name, privilege, recent_ledger, recent_change_log } = dashboard;

  const spend12m = Number(privilege.privilege_tier_qualified_spend_12m_sar);
  const balance = Number(privilege.cashback_balance_sar);
  const currentTier = privilege.privilege_tier;
  const nextTier = stepUpOne(currentTier);
  const isTopTier = nextTier === currentTier;
  const progress = progressToNextTier(currentTier, spend12m);
  const remaining = spendRemainingToNextTier(currentTier, spend12m);
  const currentPct = TIER_CASHBACK_PCT[currentTier];

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <p className="font-ar text-sm text-ink-secondary">
          {privilegeAr.programName}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-ar text-2xl text-ink-primary">
              {privilegeAr.publicTitle}
            </h1>
            <p className="font-ar text-sm text-ink-secondary">{full_name}</p>
          </div>
          <TierBadge tier={currentTier} size="lg" />
        </div>
      </header>

      {/* Top-line state */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionBalance}
          </p>
          <p className="font-ar mt-3 text-2xl text-gold">{formatSar(balance)}</p>
          <Link
            href="/me/privilege/history"
            className="font-ar mt-3 inline-block text-xs text-gold hover:text-gold-light"
          >
            عرض كامل السجل ←
          </Link>
        </div>
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            {privilegeAr.sectionSpendWindow}
          </p>
          <p className="font-ar mt-3 text-2xl text-ink-primary">
            {formatSar(spend12m)}
          </p>
          <p className="font-ar mt-2 text-xs text-ink-secondary">
            {privilegeAr.kpiCashbackPct}: {currentPct}%
          </p>
        </div>
        <div className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-secondary">
            تاريخ الإسناد
          </p>
          <p className="font-ar mt-3 text-lg text-ink-primary">
            {formatDate(privilege.privilege_tier_assigned_at)}
          </p>
          {privilege.tier_locked_until && (
            <p className="font-ar mt-2 text-xs text-ink-secondary">
              {privilegeAr.fieldLockedUntil}: {formatDate(privilege.tier_locked_until)}
            </p>
          )}
        </div>
      </section>

      {/* Progress to next tier */}
      {!isTopTier && (
        <section className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-ar text-lg text-ink-primary">
              التقدّم إلى المستوى التالي
            </h2>
            <TierBadge tier={nextTier} size="sm" />
          </div>
          <TierProgressBar progress={progress} />
          <p className="font-ar mt-3 text-sm text-ink-secondary">
            {remaining > 0
              ? `يتبقّى ${formatSar(remaining)} للترقية إلى ${privilegeAr.tier[nextTier]}`
              : `تأهلت لـ ${privilegeAr.tier[nextTier]} — ستظهر الترقية في حجزك القادم`}
          </p>
        </section>
      )}
      {isTopTier && (
        <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
          <h2 className="font-ar text-lg text-ink-primary">
            وصلت لأعلى مستوى — Diamond
          </h2>
          <p className="font-ar mt-2 text-sm text-ink-secondary">
            تستمتع بـ 15% استرداد + كونسيرج 24/7 + MedEvac مجاني unlimited
            عبر Aeris Shield Diamond.
          </p>
        </section>
      )}

      {/* Recent ledger */}
      <section className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-ar text-lg text-ink-primary">
            {privilegeAr.sectionRecentLedger}
          </h2>
          <Link
            href="/me/privilege/history"
            className="font-ar text-xs text-gold hover:text-gold-light"
          >
            عرض الكل ←
          </Link>
        </div>
        {recent_ledger.length === 0 ? (
          <p className="font-ar text-sm text-ink-secondary">
            لم تكسب أي استرداد بعد. ستظهر معاملاتك هنا بعد أول حجز مدفوع.
          </p>
        ) : (
          <ul className="divide-y divide-navy-card">
            {recent_ledger.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="font-ar text-sm text-ink-primary">
                    {privilegeAr.ledgerEvent[row.event_type]}
                  </p>
                  <p className="font-ar text-xs text-ink-secondary">
                    {formatDate(row.created_at)}
                  </p>
                </div>
                <div className="text-end">
                  <p
                    className={`font-ar text-sm ${
                      Number(row.amount_sar) >= 0
                        ? 'text-emerald-300'
                        : 'text-rose-300'
                    }`}
                  >
                    {Number(row.amount_sar) >= 0 ? '+' : ''}
                    {formatSar(row.amount_sar)}
                  </p>
                  <p className="font-ar text-xs text-ink-secondary">
                    الرصيد: {formatSar(row.balance_after_sar)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent tier changes */}
      {recent_change_log.length > 0 && (
        <section className="rounded-2xl border border-navy-card bg-navy-card/40 p-5">
          <h2 className="font-ar mb-4 text-lg text-ink-primary">
            {privilegeAr.sectionRecentChanges}
          </h2>
          <ul className="divide-y divide-navy-card">
            {recent_change_log.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between py-3"
              >
                <div className="flex items-center gap-3">
                  <TierBadge tier={row.from_tier} size="sm" />
                  <span className="font-ar text-xs text-ink-secondary">←→</span>
                  <TierBadge tier={row.to_tier} size="sm" />
                </div>
                <div className="text-end">
                  <p className="font-ar text-sm text-ink-primary">
                    {privilegeAr.changeReason[row.reason]}
                  </p>
                  <p className="font-ar text-xs text-ink-secondary">
                    {formatDate(row.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
