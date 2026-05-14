import type { Metadata } from 'next';
import Link from 'next/link';

import { ClientChangePasswordForm } from '@/components/clients/change-password-form';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: clientsAr.changePasswordTitle,
  robots: { index: false, follow: false },
};

export default function ClientChangePasswordPage() {
  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <h1 className="font-ar text-2xl text-ink-primary sm:text-3xl">
          {clientsAr.changePasswordTitle}
        </h1>
        <Link
          href="/me/profile"
          className="font-ar text-xs text-gold-light hover:underline"
        >
          {clientsAr.profileTitle} ←
        </Link>
      </header>
      <p className="font-ar text-sm text-ink-muted">
        {clientsAr.changePasswordSubtitle}
      </p>

      <div className="max-w-md rounded-2xl border border-border bg-navy-card/40 p-6">
        <ClientChangePasswordForm />
      </div>
    </section>
  );
}
