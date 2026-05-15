import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CargoRequestForm } from '@/components/cargo/cargo-request-form';
import { cargoAr } from '@/lib/i18n/cargo-ar';

/**
 * Phase 11 PR 1 — public /cargo intake page.
 *
 * Anonymous browser submits a cargo_request via the
 * CargoRequestForm client component, which wraps the
 * submitCargoRequestPublic Server Action.
 *
 * Gated behind ENABLE_CARGO env flag (404 when off — same
 * pattern as Phase 9 /signup, Phase 10 /me/empty-legs).
 *
 * PR 2 will add /me/cargo-requests for authenticated clients
 * (mirror of this page with prefilled customer fields from
 * the clients table).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: cargoAr.publicPageTitle,
  description: cargoAr.publicPageSubtitle,
};

export default function PublicCargoPage() {
  if (process.env.ENABLE_CARGO !== 'true') notFound();

  return (
    <section className="space-y-8 pb-16">
      <header className="space-y-3">
        <h1 className="font-ar text-3xl text-ink-primary sm:text-4xl">
          {cargoAr.publicPageTitle}
        </h1>
        <p className="font-ar max-w-2xl text-base text-ink-muted">
          {cargoAr.publicPageSubtitle}
        </p>
      </header>

      <CargoRequestForm />
    </section>
  );
}
