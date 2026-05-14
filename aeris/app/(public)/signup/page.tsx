import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClientPublicShell } from '@/components/clients/public-shell';
import { ClientSignupForm } from '@/components/clients/signup-form';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.signupTitle,
  robots: { index: false, follow: false },
};

export default function ClientSignupPage() {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  return (
    <ClientPublicShell
      title={clientsAr.signupTitle}
      subtitle={clientsAr.signupSubtitle}
    >
      <ClientSignupForm />
    </ClientPublicShell>
  );
}
