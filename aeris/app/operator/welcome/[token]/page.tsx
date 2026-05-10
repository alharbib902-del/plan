import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OperatorPublicShell } from '@/components/operator/public-shell';
import { OperatorWelcomeHandoff } from '@/components/operator/welcome-handoff';
import { operatorsAr } from '@/lib/i18n/operators-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: operatorsAr.portal.welcome.title,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { token: string };
}

export default function OperatorWelcomePage({ params }: PageProps) {
  if (process.env.ENABLE_OPERATOR_PORTAL === 'false') notFound();
  if (!params.token || params.token.length === 0) notFound();

  return (
    <OperatorPublicShell title={operatorsAr.portal.welcome.title}>
      <OperatorWelcomeHandoff rawToken={params.token} />
    </OperatorPublicShell>
  );
}
