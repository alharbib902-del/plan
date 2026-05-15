import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';

import { requireClientSession } from '@/lib/clients/auth';
import { CargoRequestForm } from '@/components/cargo/cargo-request-form';
import { cargoAr } from '@/lib/i18n/cargo-ar';

/**
 * Phase 11 PR 2 — authed cargo request form page.
 *
 * Re-uses the public form component with `mode='authed'`.
 * The §4.2 RPC sources customer name/phone/email from the
 * clients table at session.client_id (Phase 9 PR 2 immutable-
 * snapshot discipline) so the form hides those fields entirely.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.meNewPageTitle,
  robots: { index: false, follow: false },
};

export default async function NewCargoRequestPage() {
  if (process.env.ENABLE_CARGO !== 'true') notFound();

  const session = await requireClientSession();
  if (!session) redirect('/login?redirect=/me/cargo-requests/new');

  return (
    <section className="space-y-6">
      <header>
        <Link
          href="/me/cargo-requests"
          className="font-ar text-xs text-ink-muted hover:text-gold-light"
        >
          {cargoAr.meNewBackToList}
        </Link>
        <h1 className="font-ar mt-3 text-2xl text-ink-primary sm:text-3xl">
          {cargoAr.meNewPageTitle}
        </h1>
        <p className="font-ar mt-1 text-sm text-ink-muted">
          {cargoAr.meNewPageSubtitle}
        </p>
      </header>

      <CargoRequestForm mode="authed" />
    </section>
  );
}
