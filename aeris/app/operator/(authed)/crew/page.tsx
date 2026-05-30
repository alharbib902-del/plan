import 'server-only';

import type { Metadata } from 'next';

import { requireOperatorSession } from '@/lib/operators/auth';
import { listOperatorCrew } from '@/lib/operators/crew';
import { CrewManager } from '@/components/operator/crew-manager';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.crew.title,
  robots: { index: false, follow: false },
};

export default async function OperatorCrewPage() {
  const session = await requireOperatorSession();
  const crew = await listOperatorCrew(session.operator_id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.portal.crew.title}
        </h1>
        <p className="font-ar mt-1 max-w-2xl text-sm text-ink-muted">
          {operatorsAr.portal.crew.subtitle}
        </p>
      </header>

      <CrewManager crew={crew} />
    </section>
  );
}
