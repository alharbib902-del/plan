import type { Metadata } from 'next';
import Link from 'next/link';

import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.meLandingTitle,
  robots: { index: false, follow: false },
};

/**
 * Phase 9 PR 1 — `/me` landing page.
 *
 * Placeholder while PR 2 (charter form) + PR 3 (requests
 * list) land. Once `/me/charter` ships in PR 2 this page
 * will redirect there for new sessions.
 */
export default function ClientMeLandingPage() {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.meLandingTitle}
        </h1>
        <p className="font-ar mt-2 text-sm text-ink-muted">
          {clientsAr.meLandingSubtitle}
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-navy-card/40 p-6">
        <Link
          href="/me/profile"
          className="font-ar inline-flex items-center gap-2 rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/25"
        >
          {clientsAr.meLandingProfileLink}
        </Link>
      </div>
    </section>
  );
}
