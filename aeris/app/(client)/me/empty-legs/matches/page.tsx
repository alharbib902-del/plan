import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { requireClientSession } from '@/lib/clients/auth';
import { listMatchedEmptyLegsForClient } from '@/lib/clients/queries/me-empty-legs';
import { EmptyLegMatchesTable } from '@/components/clients/empty-leg-table';
import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 10 PR 2 — `/me/empty-legs/matches` read-only ledger.
 *
 * Stable canonical URL for the matches list (the tabbed
 * `/me/empty-legs` page is the default landing point + has the
 * same data as the matches tab; this dedicated route exists so
 * email links from sendClientEmptyLegMatchEmail can target a
 * stable URL that always shows matches even if the tab default
 * changes in a future phase).
 *
 * Implementation: same data fetch as the tabbed page; renders
 * just the matches table without tab navigation.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: `${clientsAr.emptyLegsPortalTitle} — ${clientsAr.emptyLegsTabMatches}`,
  robots: { index: false, follow: false },
};

export default async function ClientMeEmptyLegsMatchesPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  if (process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL !== 'true') notFound();

  const session = await requireClientSession();
  const matches = await listMatchedEmptyLegsForClient(session.client_id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.emptyLegsTabMatches}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {clientsAr.emptyLegsMatchesSubtitle}
        </p>
      </header>
      <EmptyLegMatchesTable entries={matches} />
    </section>
  );
}
