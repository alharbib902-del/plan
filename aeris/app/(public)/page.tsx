import Link from 'next/link';

import { Hero } from '@/components/sections/hero';
import { Services } from '@/components/sections/services';
import { WhyAeris } from '@/components/sections/why-aeris';
import { CtaBanner } from '@/components/sections/cta-banner';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export default function HomePage() {
  // Phase 7 PR 2d: home-page CTA card for the public
  // marketplace. Server-only flag — when off, the card
  // is omitted entirely from the rendered HTML so search
  // engines + visitors never see the inactive surface.
  const showEmptyLegsCta =
    process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE === 'true';

  return (
    <>
      <Hero />
      <Services />
      <WhyAeris />
      {showEmptyLegsCta ? <EmptyLegsCta /> : null}
      <CtaBanner />
    </>
  );
}

function EmptyLegsCta() {
  return (
    <section className="border-y border-border bg-navy-secondary/40 py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/5 to-transparent p-8 sm:p-12">
          <div className="flex flex-col gap-4 text-end">
            <h2 className="font-ar text-2xl text-ink sm:text-3xl">
              {emptyLegsAr.homeEmptyLegsCtaTitle}
            </h2>
            <p className="font-ar text-base text-ink-secondary">
              {emptyLegsAr.homeEmptyLegsCtaSubtitle}
            </p>
            <div>
              <Link
                href="/empty-legs"
                className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/15 px-6 py-3 text-base text-gold-light transition-colors hover:bg-gold/25"
              >
                {emptyLegsAr.homeEmptyLegsCtaButton}
                <span aria-hidden>←</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
