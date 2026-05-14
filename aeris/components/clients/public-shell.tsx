import Link from 'next/link';
import type { ReactNode } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';

/**
 * Phase 9 PR 1 — minimal Arabic-RTL shell for the public
 * auth pages (`/login`, `/signup`, `/forgot-password`,
 * `/reset-password/[token]`). Mirror of
 * `components/operator/public-shell.tsx`.
 */

interface ClientPublicShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function ClientPublicShell({
  title,
  subtitle,
  children,
}: ClientPublicShellProps) {
  return (
    <main dir="rtl" className="min-h-screen bg-navy">
      <header className="border-b border-border bg-navy-secondary/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link
            href="/"
            className="font-ar tracking-tagged text-gold-light hover:text-gold"
          >
            {clientsAr.brand}
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-md px-6 py-12">
        <h1 className="font-ar mb-2 text-2xl text-ink-primary sm:text-3xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="font-ar mb-6 text-sm text-ink-muted">{subtitle}</p>
        ) : (
          <div className="mb-6" />
        )}
        <div className="rounded-2xl border border-border bg-navy-card/40 p-6 shadow-md">
          {children}
        </div>
      </div>
    </main>
  );
}
