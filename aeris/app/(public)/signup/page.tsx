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

interface SignupPageProps {
  // Referral share links land here as /signup?ref=CODE → prefilled.
  searchParams: Promise<{ ref?: string }>;
}

export default async function ClientSignupPage({
  searchParams,
}: SignupPageProps) {
  if (process.env.ENABLE_CLIENT_PORTAL !== 'true') notFound();
  const { ref } = await searchParams;
  const initialReferralCode =
    typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : undefined;
  return (
    <ClientPublicShell
      title={clientsAr.signupTitle}
      subtitle={clientsAr.signupSubtitle}
    >
      <ClientSignupForm initialReferralCode={initialReferralCode} />
    </ClientPublicShell>
  );
}
