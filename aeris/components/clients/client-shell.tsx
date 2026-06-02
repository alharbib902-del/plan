'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { supportAr } from '@/lib/i18n/support-ar';
import { referralsAr } from '@/lib/i18n/referrals-ar';
import { clientLogout } from '@/app/actions/clients-public';

interface ClientShellProps {
  fullName: string;
  children: ReactNode;
}

/**
 * Phase 9 PR 1 — authenticated client portal layout shell.
 * Header with brand + nav + logout button + content slot.
 * Mirror of `components/operator/portal-shell.tsx`.
 */
export function ClientShell({ fullName, children }: ClientShellProps) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onLogout = () => {
    startTransition(async () => {
      await clientLogout();
      router.push('/login');
      router.refresh();
    });
  };

  return (
    <div dir="rtl" className="min-h-screen bg-navy">
      <header className="border-b border-border bg-navy-secondary/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/me"
              className="font-ar shrink-0 tracking-tagged text-gold-light hover:text-gold"
            >
              {clientsAr.brand}
            </Link>
            <nav className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <NavLink href="/me" active={pathname === '/me'}>
                {clientsAr.navMyArea}
              </NavLink>
              <NavLink
                href="/me/requests"
                active={pathname.startsWith('/me/requests')}
              >
                {clientsAr.meRequestsTitle}
              </NavLink>
              <NavLink
                href="/me/bookings"
                active={pathname.startsWith('/me/bookings')}
              >
                {clientsAr.meBookingsTitle}
              </NavLink>
              <NavLink
                href="/me/reviews"
                active={pathname.startsWith('/me/reviews')}
              >
                {clientsAr.meReviewsTitle}
              </NavLink>
              <NavLink
                href="/me/support"
                active={pathname.startsWith('/me/support')}
              >
                {supportAr.nav}
              </NavLink>
              <NavLink
                href="/me/referrals"
                active={pathname.startsWith('/me/referrals')}
              >
                {referralsAr.nav}
              </NavLink>
              <NavLink
                href="/me/profile"
                active={pathname.startsWith('/me/profile')}
              >
                {clientsAr.navProfile}
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-ar hidden text-xs text-ink-muted sm:inline">
              {fullName}
            </span>
            <button
              type="button"
              onClick={onLogout}
              disabled={isPending}
              className="font-ar rounded-md border border-border bg-navy-card/60 px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light disabled:opacity-60"
            >
              {clientsAr.navLogout}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`font-ar rounded-md px-3 py-1.5 transition-colors ${
        active
          ? 'bg-navy-card text-gold-light'
          : 'text-ink-secondary hover:bg-navy-card/60 hover:text-gold-light'
      }`}
    >
      {children}
    </Link>
  );
}
