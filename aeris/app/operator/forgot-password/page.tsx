import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OperatorPublicShell } from '@/components/operator/public-shell';
import { OperatorForgotPasswordForm } from '@/components/operator/forgot-password-form';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.forgotPassword.title,
  robots: { index: false, follow: false },
};

export default function OperatorForgotPasswordPage() {
  if (process.env.ENABLE_OPERATOR_PORTAL === 'false') notFound();
  return (
    <OperatorPublicShell
      title={operatorsAr.portal.forgotPassword.title}
      subtitle={operatorsAr.portal.forgotPassword.subtitle}
    >
      <OperatorForgotPasswordForm />
    </OperatorPublicShell>
  );
}
