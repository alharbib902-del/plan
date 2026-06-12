import Link from 'next/link';
import { ArrowLeft, Wallet, Zap, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { TierBadge } from '@/components/privilege/tier-badge';
import { readPublicTierThresholds } from '@/lib/privilege/client-pii';
import { privilegeAr } from '@/lib/i18n/privilege-ar';
import type { ClientPrivilegeTier } from '@/lib/privilege/types';

type Benefit = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const BENEFITS: Benefit[] = [
  {
    icon: Wallet,
    title: 'كاش باك على كل رحلة مدفوعة',
    description:
      'يُضاف تلقائياً إلى محفظتك بعد كل رحلة، وتستخدمه في حجوزاتك القادمة.',
  },
  {
    icon: Zap,
    title: 'وصول مبكر للرحلات الفارغة',
    description:
      'كلما ارتفع مستواك، وصلتك عروض الرحلات الفارغة قبل الإعلان العام.',
  },
  {
    icon: Users,
    title: 'مكافآت إحالة',
    description: 'ادعُ من تثق بهم واكسب مكافآت عند أول حجز مدفوع لهم.',
  },
];

// Fail-soft + fallback order: the section renders the static tier
// ladder even when the thresholds read fails — only the live cashback
// percentages drop out.
const TIER_ORDER_FALLBACK: ClientPrivilegeTier[] = [
  'silver',
  'gold',
  'platinum',
  'diamond',
];

async function readThresholdsSafe() {
  try {
    return await readPublicTierThresholds();
  } catch {
    return [];
  }
}

export async function PrivilegeTeaser() {
  const thresholds = await readThresholdsSafe();
  const maxCashback = thresholds.reduce(
    (max, t) => Math.max(max, Number(t.cashback_pct) || 0),
    0
  );

  return (
    <section className="border-y border-border bg-navy-secondary/40 py-20 sm:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          <span className="font-ar inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold-light">
            {privilegeAr.programName}
          </span>
          <h2 className="font-ar mt-6 text-3xl leading-tight text-ink sm:text-4xl">
            كلما حلّقت أكثر، ارتفعت درجتك
          </h2>
          <p className="font-ar mt-4 max-w-xl text-sm leading-7 text-ink-secondary sm:text-base">
            أربعة مستويات تتصاعد مزاياها مع كل رحلة مدفوعة
            {maxCashback > 0 ? (
              <>
                {' '}
                — وكاش باك يصل إلى{' '}
                <span className="text-gold-light">{maxCashback}%</span> من قيمة
                الرحلة.
              </>
            ) : (
              '.'
            )}
          </p>

          <ul className="mt-8 space-y-5">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <li key={benefit.title} className="flex items-start gap-4">
                  <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-ar text-base text-ink">
                      {benefit.title}
                    </h3>
                    <p className="font-ar mt-1 text-sm leading-6 text-ink-secondary">
                      {benefit.description}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-10 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Link
              href="/privilege"
              className="font-ar inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-6 py-3 text-sm font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow"
            >
              اكتشف برنامج Privilege
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Link>
            <Link
              href="/signup"
              className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-gold/40 px-6 py-3 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/10"
            >
              انضم الآن مجاناً
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-navy-card/40 p-6 backdrop-blur-sm sm:p-8">
          <p className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
            مستويات العضوية
          </p>
          <ul className="mt-5 space-y-4">
            {(thresholds.length > 0
              ? thresholds.map((t) => ({
                  tier: t.tier,
                  cashback: Number(t.cashback_pct) || 0,
                }))
              : TIER_ORDER_FALLBACK.map((tier) => ({ tier, cashback: 0 }))
            ).map((row) => (
              <li
                key={row.tier}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-navy/40 px-4 py-3"
              >
                <TierBadge tier={row.tier} size="lg" />
                <span className="font-ar text-sm text-ink-secondary">
                  {row.cashback > 0 ? (
                    <>
                      <span className="text-lg text-gold-light">
                        {row.cashback}%
                      </span>{' '}
                      كاش باك
                    </>
                  ) : (
                    'مزايا متصاعدة'
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="font-ar mt-5 text-xs leading-6 text-ink-muted">
            الترقية فورية عند بلوغ الحد، والمزايا تشمل حجوزات الرحلات الخاصة
            والرحلات الفارغة.
          </p>
        </div>
      </div>
    </section>
  );
}

export function PrivilegeTeaserSkeleton() {
  return (
    <section
      className="border-y border-border bg-navy-secondary/40 py-20 sm:py-24"
      aria-hidden
    >
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          <div className="h-7 w-36 animate-pulse rounded-full bg-navy-card/60" />
          <div className="mt-6 h-9 w-3/4 animate-pulse rounded-lg bg-navy-card/60" />
          <div className="mt-4 h-5 w-full max-w-md animate-pulse rounded-lg bg-navy-card/40" />
          <div className="mt-8 space-y-5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-navy-card/40"
              />
            ))}
          </div>
        </div>
        <div className="h-80 animate-pulse rounded-2xl border border-border bg-navy-card/40" />
      </div>
    </section>
  );
}
