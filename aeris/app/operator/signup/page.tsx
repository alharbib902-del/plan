import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OperatorPublicShell } from '@/components/operator/public-shell';
import { OperatorSignupForm } from '@/components/operator/signup-form';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.signup.title,
  robots: { index: false, follow: false },
};

export default function OperatorSignupPage() {
  if (process.env.ENABLE_OPERATOR_PORTAL !== 'true') notFound();

  return (
    <OperatorPublicShell
      title={operatorsAr.portal.signup.title}
      subtitle={operatorsAr.portal.signup.subtitle}
    >
      <OperatorSignupForm />
    </OperatorPublicShell>
  );
}
