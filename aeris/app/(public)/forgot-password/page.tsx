import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClientPublicShell } from '@/components/clients/public-shell';
import { ClientForgotPasswordForm } from '@/components/clients/forgot-password-form';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.forgotTitle,
  robots: { index: false, follow: false },
};

export default function ClientForgotPasswordPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  return (
    <ClientPublicShell
      title={clientsAr.forgotTitle}
      subtitle={clientsAr.forgotSubtitle}
    >
      <ClientForgotPasswordForm />
    </ClientPublicShell>
  );
}
