import type { Metadata } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { listAirports } from '@/lib/supabase/queries/airports';
import {
  OperatorPublishForm,
  type OperatorFleetAircraft,
} from '@/components/operator/empty-legs/operator-publish-form';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.dashboard.addLeg,
  robots: { index: false, follow: false },
};

/**
 * Phase 8 PR 2c.1 — session-bound publish page.
 *
 * Re-uses Phase 7's OperatorPublishForm with mode="session"
 * (added in PR 2c.1). The form calls operatorPublishLegSession
 * which pulls operator_id from the session cookie via
 * requireOperatorSession() and forces operator_stub_id=NULL,
 * then routes to /operator/legs/<leg_id> on success.
 *
 * UX follow-up: the page now ships the operator's ACTIVE fleet +
 * the private-capable airports list so the form renders an
 * aircraft picker (instead of free text) and the shared
 * AirportCombobox (instead of raw IATA inputs). Pure UI — the
 * submit shape is unchanged (aircraft_text + *_iata/_freeform),
 * so the Server Action + RPC stay untouched.
 */
export default async function OperatorPublishLegPage() {
  const session = await requireOperatorSession();

  const [airports, aircraft] = await Promise.all([
    listAirports({ privateCapable: true }),
    loadOperatorActiveAircraft(session.operator_id),
  ]);

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary">
          {operatorsAr.portal.dashboard.addLeg}
        </h1>
        <Link
          href="/operator/legs"
          className="font-ar mt-2 inline-block text-xs text-ink-muted hover:text-gold-light"
        >
          ← الرجوع إلى قائمة الرحلات
        </Link>
      </header>

      <OperatorPublishForm
        mode="session"
        airports={airports}
        aircraft={aircraft}
      />
    </section>
  );
}

/**
 * Load the session operator's ACTIVE aircraft for the publish
 * form's fleet picker. Scoped to the authenticated operator_id
 * (never client-supplied). An empty fleet makes the form fall
 * back to a free-text aircraft field, so the page never blocks
 * an operator who has not registered aircraft yet.
 */
async function loadOperatorActiveAircraft(
  operatorId: string
): Promise<OperatorFleetAircraft[]> {
  const client = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await client
    .from('aircraft')
    .select('id, registration, manufacturer, model')
    .eq('operator_id', operatorId)
    .eq('status', 'active')
    .order('registration', { ascending: true });

  if (error) {
    console.error('[operator/legs/new] active-fleet load failed', error);
    return [];
  }
  return (data ?? []) as OperatorFleetAircraft[];
}
