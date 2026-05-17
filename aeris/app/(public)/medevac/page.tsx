import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { MedevacRequestForm } from '@/components/medevac/medevac-request-form';
import { medevacAr } from '@/lib/i18n/medevac-ar';

/**
 * Phase 12 PR 1 — public /medevac intake page.
 *
 * Anonymous browser submits a medevac_request via the
 * MedevacRequestForm client component, which wraps the
 * submitMedevacRequestPublic Server Action.
 *
 * Gated behind ENABLE_MEDEVAC env flag (404 when off — same
 * pattern as Phase 9 /signup, Phase 11 /cargo).
 *
 * The public path is hard-locked to severity='stable' (D1):
 * moderate/critical require an authed account. The form
 * renders the lock notice prominently and the severity
 * dropdown is disabled with the only option being 'stable'.
 *
 * PR 2 will add /me/medevac for authenticated clients
 * (allowed all severities, plus the Shield use_subscription
 * toggle).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: medevacAr.publicPageTitle,
  description: medevacAr.publicPageSubtitle,
};

export default function PublicMedevacPage() {
  if (process.env.ENABLE_MEDEVAC !== 'true') notFound();

  return (
    <div className="relative bg-navy">
      <section className="mx-auto max-w-4xl space-y-10 px-4 pb-24 pt-32 sm:px-6 lg:px-8">
        <header className="space-y-4 text-center">
          <span className="font-ar inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-rose-300">
            {medevacAr.navMedevac}
          </span>
          <h1 className="font-ar text-3xl leading-tight text-ink-primary sm:text-4xl md:text-5xl">
            {medevacAr.publicPageTitle}
          </h1>
          <p className="font-ar mx-auto max-w-2xl text-base leading-7 text-ink-secondary">
            {medevacAr.publicPageSubtitle}
          </p>
        </header>

        <MedevacRequestForm />
      </section>
    </div>
  );
}
