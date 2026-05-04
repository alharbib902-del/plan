import { Hero } from '@/components/sections/hero';
import { Services } from '@/components/sections/services';
import { WhyAeris } from '@/components/sections/why-aeris';
import { CtaBanner } from '@/components/sections/cta-banner';

export default function HomePage() {
  return (
    <>
      <Hero />
      <Services />
      <WhyAeris />
      <CtaBanner />
    </>
  );
}
