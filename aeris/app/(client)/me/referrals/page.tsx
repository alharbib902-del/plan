import 'server-only';

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import {
  getOrCreateReferralCode,
  listMyReferrals,
  type MyReferralRow,
} from '@/lib/clients/referrals';
import { referralRewardAmounts } from '@/lib/clients/referral-rewards';
import { ReferralCodeCard } from '@/components/clients/referral-code-card';
import { referralsAr } from '@/lib/i18n/referrals-ar';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: referralsAr.metaTitle,
  robots: { index: false, follow: false },
};

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://aeris.sa').replace(/\/$/, '');
}

function formatSAR(amount: number): string {
  try {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
      amount
    );
  } catch {
    return String(amount);
  }
}

function formatDateAr(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const STATUS_TONE: Record<MyReferralRow['status'], string> = {
  signed_up: 'border-gold/40 bg-gold/10 text-gold-light',
  rewarded: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
};

const STATUS_LABEL: Record<MyReferralRow['status'], string> = {
  signed_up: referralsAr.statusSignedUp,
  rewarded: referralsAr.statusRewarded,
};

export default async function MyReferralsPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  const session = await requireClientSession();

  const [code, referrals] = await Promise.all([
    getOrCreateReferralCode(session.client_id),
    listMyReferrals(session.client_id),
  ]);

  const amounts = referralRewardAmounts();
  const currency = clientsAr.currencySAR;
  const shareUrl = code
    ? `${siteBaseUrl()}/signup?ref=${encodeURIComponent(code)}`
    : null;

  const rewardedCount = referrals.filter((r) => r.status === 'rewarded').length;
  const pendingCount = referrals.length - rewardedCount;
  const totalEarned = referrals.reduce(
    (sum, r) => sum + (r.status === 'rewarded' ? r.referrer_reward_sar ?? 0 : 0),
    0
  );

  const rewardCallout =
    amounts.referrer === amounts.referee
      ? `${formatSAR(amounts.referrer)} ${currency}`
      : `${formatSAR(amounts.referrer)} ${currency} / ${formatSAR(amounts.referee)} ${currency}`;

  return (
    <section dir="rtl" className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {referralsAr.heading}
        </h1>
        <p className="font-ar mt-2 max-w-2xl text-sm text-ink-muted">
          {referralsAr.intro}
        </p>
      </header>

      <div className="rounded-xl border border-gold/30 bg-gold/10 p-4">
        <span className="font-ar block text-xs text-ink-muted">
          {referralsAr.rewardCalloutLabel}
        </span>
        <span className="font-ar mt-1 block text-xl text-gold-light">
          {rewardCallout}
        </span>
      </div>

      {code && shareUrl ? (
        <ReferralCodeCard code={code} shareUrl={shareUrl} />
      ) : (
        <p className="font-ar rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
          {referralsAr.codeUnavailable}
        </p>
      )}

      <div className="rounded-xl border border-border bg-navy-card/40 p-5">
        <h2 className="font-ar text-lg text-ink-primary">
          {referralsAr.howHeading}
        </h2>
        <ol className="font-ar mt-3 space-y-2 text-sm text-ink-secondary">
          <Step n={1}>{referralsAr.step1}</Step>
          <Step n={2}>{referralsAr.step2}</Step>
          <Step n={3}>{referralsAr.step3}</Step>
        </ol>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label={referralsAr.summaryEarned} value={`${formatSAR(totalEarned)} ${currency}`} />
        <Tile label={referralsAr.summaryRewarded} value={String(rewardedCount)} />
        <Tile label={referralsAr.summaryPending} value={String(pendingCount)} />
      </div>

      <section className="space-y-3">
        <h2 className="font-ar text-lg text-ink-primary">
          {referralsAr.listHeading}
        </h2>
        {referrals.length === 0 ? (
          <p className="font-ar rounded-xl border border-border bg-navy-card/40 p-6 text-sm text-ink-muted">
            {referralsAr.listEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-navy-card/40">
            <table className="w-full min-w-[420px] border-collapse text-start">
              <thead>
                <tr className="border-b border-border">
                  <Th>{referralsAr.colDate}</Th>
                  <Th>{referralsAr.colStatus}</Th>
                  <Th>{referralsAr.colReward}</Th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border/60 last:border-b-0"
                  >
                    <Td>{formatDateAr(r.created_at)}</Td>
                    <Td>
                      <span
                        className={`font-ar inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_TONE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </Td>
                    <Td>
                      {r.status === 'rewarded' && r.referrer_reward_sar != null
                        ? `${formatSAR(r.referrer_reward_sar)} ${currency}`
                        : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="font-ar mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-[11px] text-gold-light">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-4">
      <div className="font-ar text-xs text-ink-muted">{label}</div>
      <div className="font-ar mt-1 text-lg text-ink-primary">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="font-ar p-3 text-xs font-normal text-ink-muted"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="font-ar p-3 text-sm text-ink-primary">{children}</td>;
}
