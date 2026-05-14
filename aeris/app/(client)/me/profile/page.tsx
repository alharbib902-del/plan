import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ClientProfileForm } from '@/components/clients/profile-form';
import { requireClientSession } from '@/lib/clients/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.profileTitle,
  robots: { index: false, follow: false },
};

export default async function ClientProfilePage() {
  const session = await requireClientSession();

  const client = createAdminClient();
  const { data: row, error } = await client
    .from('clients')
    .select('full_name, contact_phone, auth_email, marketing_opt_in')
    .eq('id', session.client_id)
    .maybeSingle();

  if (error || !row) {
    console.error('[/me/profile] lookup error', error);
    notFound();
  }

  const initial = row as unknown as {
    full_name: string;
    contact_phone: string;
    auth_email: string;
    marketing_opt_in: boolean;
  };

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.profileTitle}
        </h1>
        <Link
          href="/me/profile/password"
          className="font-ar text-xs text-gold-light hover:underline"
        >
          {clientsAr.profileChangePasswordLink} ←
        </Link>
      </header>

      <div className="rounded-2xl border border-border bg-navy-card/40 p-6">
        <ClientProfileForm initial={initial} />
      </div>
    </section>
  );
}
