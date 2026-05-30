import 'server-only';

import type { Metadata } from 'next';

import { requireOperatorSession } from '@/lib/operators/auth';
import { listOperatorAircraft } from '@/lib/operators/fleet';
import { FleetManager } from '@/components/operator/fleet-manager';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.fleet.title,
  robots: { index: false, follow: false },
};

export default async function OperatorFleetPage() {
  const session = await requireOperatorSession();
  const aircraft = await listOperatorAircraft(session.operator_id);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.portal.fleet.title}
        </h1>
        <p className="font-ar mt-1 max-w-2xl text-sm text-ink-muted">
          {operatorsAr.portal.fleet.subtitle}
        </p>
      </header>

      <FleetManager aircraft={aircraft} />
    </section>
  );
}
