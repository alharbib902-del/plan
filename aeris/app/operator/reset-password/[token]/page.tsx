import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OperatorPublicShell } from '@/components/operator/public-shell';
import { OperatorResetPasswordForm } from '@/components/operator/reset-password-form';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.resetPassword.title,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function OperatorResetPasswordPage({ params }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL !== 'true') notFound();
  const { token } = await params;
  if (!token || token.length === 0) notFound();

  return (
    <OperatorPublicShell title={operatorsAr.portal.resetPassword.title}>
      <OperatorResetPasswordForm rawToken={token} />
    </OperatorPublicShell>
  );
}
