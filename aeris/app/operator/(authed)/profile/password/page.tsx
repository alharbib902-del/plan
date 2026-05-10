import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireOperatorSession } from '@/lib/operators/auth';
import { getOperatorRowById } from '@/lib/operators/session-store';
import { OperatorPasswordChangeForm } from '@/components/operator/password-change-form';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.password.title,
  robots: { index: false, follow: false },
};

export default async function OperatorPasswordPage() {
  const session = await requireOperatorSession();
  const operator = await getOperatorRowById(session.operator_id);
  if (!operator) notFound();

  return (
    <section className="mx-auto max-w-md space-y-6">
      <header>
        <h1 className="font-ar text-2xl text-ink-primary">
          {operatorsAr.portal.password.title}
        </h1>
      </header>
      <div className="rounded-xl border border-border bg-navy-card/40 p-6">
        <OperatorPasswordChangeForm mustChange={operator.password_must_change} />
      </div>
    </section>
  );
}
