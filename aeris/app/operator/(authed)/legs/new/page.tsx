import type { Metadata } from 'next';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { OperatorPublishForm } from '@/components/operator/empty-legs/operator-publish-form';
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
 */
export default async function OperatorPublishLegPage() {
  await requireOperatorSession();

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

      <OperatorPublishForm mode="session" />
    </section>
  );
}
