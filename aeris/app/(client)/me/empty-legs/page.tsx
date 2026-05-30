import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import {
  listAvailableEmptyLegs,
  listMatchedEmptyLegsForClient,
} from '@/lib/clients/queries/me-empty-legs';
import {
  EmptyLegBrowseTable,
  EmptyLegMatchesTable,
} from '@/components/clients/empty-leg-table';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

/**
 * Phase 10 PR 2 — `/me/empty-legs` tabbed list.
 *
 * Two tabs:
 *   - "مطابقاتي" (default) — matches the dispatcher sent to
 *     this client (read from empty_leg_notifications keyed on
 *     client_id, ordered by sent_at DESC)
 *   - "تصفّح الكل" — every available leg ordered by
 *     current_price ASC
 *
 * Tab switching uses ?tab=browse-all query param so the URL is
 * shareable + back-button friendly. Default tab (no param) is
 * "matches".
 *
 * Gated behind ENABLE_CLIENT_PORTAL (Phase 9 flag — covers all
 * /me/* routes) AND ENABLE_CLIENT_EMPTY_LEGS_PORTAL (Phase 10
 * specific flag for the empty-legs feature). Both must be true.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.emptyLegsPortalTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams?: { tab?: string };
}

export default async function ClientMeEmptyLegsPage({
  searchParams,
}: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  if (process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL !== 'true') notFound();

  const session = await requireClientSession();
  const tab = searchParams?.tab === 'browse-all' ? 'browse-all' : 'matches';

  const [matches, available] = await Promise.all([
    listMatchedEmptyLegsForClient(session.client_id),
    tab === 'browse-all' ? listAvailableEmptyLegs() : Promise.resolve([]),
  ]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.emptyLegsPortalTitle}
        </h1>
        <Link
          href="/me/empty-legs/alerts"
          className="font-ar rounded-md border border-border px-3 py-1.5 text-sm text-gold-light transition-colors hover:border-gold/40 hover:text-gold"
        >
          {emptyLegsAr.alertsNavLink}
        </Link>
      </header>

      <nav className="flex gap-2 border-b border-border">
        <TabLink active={tab === 'matches'} href="/me/empty-legs">
          {clientsAr.emptyLegsTabMatches}
        </TabLink>
        <TabLink
          active={tab === 'browse-all'}
          href="/me/empty-legs?tab=browse-all"
        >
          {clientsAr.emptyLegsTabBrowseAll}
        </TabLink>
      </nav>

      {tab === 'browse-all' ? (
        <EmptyLegBrowseTable legs={available} />
      ) : (
        <EmptyLegMatchesTable entries={matches} />
      )}
    </section>
  );
}

function TabLink({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  // Plain anchor (not next/link) so the server component re-runs
  // on tab switch — needed because each tab queries a different
  // dataset and we want a fresh fetch.
  return (
    <a
      href={href}
      className={`font-ar -mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
        active
          ? 'border-gold text-gold-light'
          : 'border-transparent text-ink-muted hover:text-ink'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </a>
  );
}
