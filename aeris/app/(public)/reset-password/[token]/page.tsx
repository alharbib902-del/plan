import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClientPublicShell } from '@/components/clients/public-shell';
import { ClientResetPasswordForm } from '@/components/clients/reset-password-form';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.resetTitle,
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ClientResetPasswordPage({ params }: PageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  const { token } = await params;
  return (
    <ClientPublicShell
      title={clientsAr.resetTitle}
      subtitle={clientsAr.resetSubtitle}
    >
      <ClientResetPasswordForm token={token} />
    </ClientPublicShell>
  );
}
