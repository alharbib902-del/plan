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

  // The site-header is `position: fixed`; pt-32 mirrors the
  // homepage hero offset so the page title clears the navbar
  // (Hero uses pt-32 too — see components/sections/hero.tsx:18).
  // max-w-4xl + mx-auto centers the form column with comfortable
  // gutters on desktop, while px-4..lg:px-8 keeps mobile readable.
  return (
    <div className="relative bg-navy">
      <section className="mx-auto max-w-4xl space-y-10 px-4 pb-24 pt-32 sm:px-6 lg:px-8">
        <header className="space-y-4 text-center">
          <span className="font-ar inline-flex items-center rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 text-xs uppercase tracking-tagged text-gold-light">
            {cargoAr.navCargo}
          </span>
          <h1 className="font-ar text-3xl leading-tight text-ink-primary sm:text-4xl md:text-5xl">
            {cargoAr.publicPageTitle}
          </h1>
          <p className="font-ar mx-auto max-w-2xl text-base leading-7 text-ink-secondary">
            {cargoAr.publicPageSubtitle}
          </p>
        </header>

        <CargoRequestForm />
      </section>
    </div>
  );
}
