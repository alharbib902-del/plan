import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClientCharterForm } from '@/components/clients/charter-form';
import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 9 PR 2 — `/me/charter` route.
 *
 * Lives under the `(client)/me/*` segment so the parent
 * `layout.tsx` (PR 1) gates access via `requireClientSession()`.
 * The fail-closed flag is also re-checked here as a defence
 * in depth — if a future deploy bypasses the layout for any
 * reason, the page still 404s when the portal is disabled.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.charterTitle,
  robots: { index: false, follow: false },
};

export default function ClientCharterPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl text-gold-light">
          {clientsAr.charterTitle}
        </h1>
        <p className="font-ar text-sm text-ink-secondary">
          {clientsAr.charterSubtitle}
        </p>
      </header>
      <ClientCharterForm />
    </div>
  );
}
