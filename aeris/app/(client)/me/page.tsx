import type { Metadata } from 'next';
import Link from 'next/link';

import { TwoFactorBanner } from '@/components/privilege/two-factor-banner';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.meLandingTitle,
  robots: { index: false, follow: false },
};

/**
 * Phase 9 PR 1 — `/me` landing page (extended in PR 2 with
 * a primary charter CTA). PR 3 will replace this with a
 * requests-list dashboard.
 */
export default async function ClientMeLandingPage() {
  return (
    <section className="space-y-6">
      <TwoFactorBanner />
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.meLandingTitle}
        </h1>
        <p className="font-ar mt-2 text-sm text-ink-muted">
          {clientsAr.meLandingSubtitle}
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-navy-card/40 p-6">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/me/charter"
            className="font-ar inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/25 px-4 py-2 text-sm font-medium text-gold-light transition-colors hover:bg-gold/35"
          >
            {clientsAr.charterTitle}
          </Link>
          <Link
            href="/me/requests"
            className="font-ar inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/25"
          >
            {clientsAr.meRequestsTitle}
          </Link>
          <Link
            href="/me/bookings"
            className="font-ar inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/25"
          >
            {clientsAr.meBookingsTitle}
          </Link>
          <Link
            href="/me/profile"
            className="font-ar inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/25"
          >
            {clientsAr.meLandingProfileLink}
          </Link>
        </div>
      </div>
    </section>
  );
}
