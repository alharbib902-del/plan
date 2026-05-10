import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOperatorSession } from '@/lib/operators/auth';
import { getOperatorRowById } from '@/lib/operators/session-store';
import { OperatorProfileEditForm } from '@/components/operator/profile-edit-form';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.profile.title,
  robots: { index: false, follow: false },
};

export default async function OperatorProfilePage() {
  const session = await requireOperatorSession();
  const operator = await getOperatorRowById(session.operator_id);
  if (!operator) notFound();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {operatorsAr.portal.profile.title}
        </h1>
      </header>

      <section className="rounded-xl border border-border bg-navy-card/40 p-6">
        <h2 className="font-ar mb-4 text-base font-medium text-ink-primary">
          {operatorsAr.portal.profile.sectionBasic}
        </h2>
        <OperatorProfileEditForm
          initialCompanyName={operator.company_name}
          initialContactEmail={operator.contact_email}
          initialContactPhone={operator.contact_phone}
          authEmail={operator.auth_email}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Link
          href="/operator/profile/password"
          className="font-ar rounded-xl border border-border bg-navy-card/40 p-5 transition-colors hover:border-gold/40"
        >
          <h3 className="text-base font-medium text-ink-primary">
            {operatorsAr.portal.profile.sectionAuth}
          </h3>
          <p className="mt-2 text-sm text-gold-light">
            {operatorsAr.portal.profile.passwordCta} →
          </p>
        </Link>
        <Link
          href="/operator/profile/documents"
          className="font-ar rounded-xl border border-border bg-navy-card/40 p-5 transition-colors hover:border-gold/40"
        >
          <h3 className="text-base font-medium text-ink-primary">
            {operatorsAr.portal.profile.sectionDocuments}
          </h3>
          <p className="mt-2 text-sm text-gold-light">
            {operatorsAr.portal.profile.documentsCta} →
          </p>
        </Link>
      </section>
    </section>
  );
}
