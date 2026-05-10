import type { Metadata } from 'next';

import { requireOperatorSession } from '@/lib/operators/auth';
import { OperatorEarningsPlaceholder } from '@/components/operator/earnings-placeholder';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.earnings.title,
  robots: { index: false, follow: false },
};

export default async function OperatorEarningsPage() {
  await requireOperatorSession();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.portal.earnings.title}
        </h1>
      </header>
      <OperatorEarningsPlaceholder />
    </section>
  );
}
