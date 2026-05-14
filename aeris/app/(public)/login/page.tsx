import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClientPublicShell } from '@/components/clients/public-shell';
import { ClientLoginForm } from '@/components/clients/login-form';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.loginTitle,
  robots: { index: false, follow: false },
};

export default function ClientLoginPage() {
  // Fail-closed (Codex round 1 PR #55 P2 #2): default
  // disabled when env is unset.
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  return (
    <ClientPublicShell
      title={clientsAr.loginTitle}
      subtitle={clientsAr.loginSubtitle}
    >
      <ClientLoginForm />
    </ClientPublicShell>
  );
}
