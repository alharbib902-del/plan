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
