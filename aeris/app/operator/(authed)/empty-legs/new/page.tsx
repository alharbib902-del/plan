import type { Metadata } from 'next';
import Link from 'next/link';

import { requireOperatorSession } from '@/lib/operators/auth';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.dashboard.addLeg,
  robots: { index: false, follow: false },
};

/**
 * Phase 8 PR 2c — placeholder for the session-based publish
 * form. Spec §6 calls for re-using Phase 7's
 * `OperatorPublishForm` with the session's operator_id
 * substituted for operator_stub_id. The integration is
 * deferred to a follow-up PR (PR 2c.1) so this PR ships
 * the auth + portal shell + read pages first; the publish
 * form re-use is a non-trivial Phase 7 component refactor.
 *
 * Until then, the founder uses /admin/empty-legs/new to
 * publish on behalf of an operator (Phase 7 admin form).
 */
export default async function OperatorPublishLegPage() {
  await requireOperatorSession();

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary">
          {operatorsAr.portal.dashboard.addLeg}
        </h1>
      </header>
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
        <p className="font-ar text-sm text-amber-100">
          نشر الرحلات الفارغة مباشرةً من بوابة المشغّل قيد التطوير. حالياً، تواصل مع فريق الإدارة لنشر رحلة جديدة بالنيابة عنك.
        </p>
        <Link
          href="/operator/empty-legs"
          className="font-ar mt-3 inline-block text-xs text-amber-200 hover:underline"
        >
          ← الرجوع إلى قائمة الرحلات
        </Link>
      </div>
    </section>
  );
}
