import { Suspense } from 'react';

import { Hero } from '@/components/sections/hero';
import { Services } from '@/components/sections/services';
import { HowItWorks } from '@/components/sections/how-it-works';
import {
  LiveEmptyLegs,
  LiveEmptyLegsSkeleton,
} from '@/components/sections/live-empty-legs';
import {
  PrivilegeTeaser,
  PrivilegeTeaserSkeleton,
} from '@/components/sections/privilege-teaser';
import { WhyAeris } from '@/components/sections/why-aeris';
import { CtaBanner } from '@/components/sections/cta-banner';

// ISR: nothing here is per-visitor (no cookies/session), so the page is
// served from cache and re-rendered at most once a minute. Trade-off: a
// leg reserved/sold or re-priced in the meantime can still show for up to
// ~60s (longer on a quiet site — the first hit after expiry gets the old
// copy while the refresh runs). Safe because the cards only link to the
// always-dynamic leg page, and the reserve_* RPCs lock + re-check
// availability, so a stale card can never book an unavailable leg.
export const revalidate = 60;

export default function HomePage() {
  // Server-only flags — when off, the section is omitted entirely from
  // the rendered HTML so search engines + visitors never see the
  // inactive surface. The flagged sections fetch live data, so they
  // stream behind Suspense: the hero/services shell paints immediately
  // and the data-backed sections fill in without blocking first paint.
  const showEmptyLegs =
    process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE === 'true';
  const showPrivilege = process.env.ENABLE_PRIVILEGE === 'true';

  return (
    <>
      <Hero />
      <Services />
      <HowItWorks />
      {showEmptyLegs ? (
        <Suspense fallback={<LiveEmptyLegsSkeleton />}>
          <LiveEmptyLegs />
        </Suspense>
      ) : null}
      {showPrivilege ? (
        <Suspense fallback={<PrivilegeTeaserSkeleton />}>
          <PrivilegeTeaser />
        </Suspense>
      ) : null}
      <WhyAeris />
      <CtaBanner />
    </>
  );
}
