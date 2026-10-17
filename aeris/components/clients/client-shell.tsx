import Link from 'next/link';
import type { ReactNode } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { supportAr } from '@/lib/i18n/support-ar';
import { referralsAr } from '@/lib/i18n/referrals-ar';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import {
  ClientLogoutButton,
  ClientNavLinks,
  type ClientNavItem,
} from './client-nav';
import { ClientMobileNav } from './client-mobile-nav';

interface ClientShellProps {
  fullName: string;
  children: ReactNode;
}

/**
 * Flag-gated entries mirror their pages' own fail-closed gates so the
 * nav never links to a notFound().
 */
function buildClientNavLinks(): ClientNavItem[] {
  const privilegeOn = process.env.ENABLE_PRIVILEGE === 'true';
  const marketplaceOn =
    process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE === 'true';
  const emptyLegAlertsOn =
    process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL === 'true';

  return [
    { href: '/me', label: clientsAr.navMyArea, match: 'exact' },
    { href: '/me/requests', label: clientsAr.meRequestsTitle, match: 'prefix' },
    { href: '/me/bookings', label: clientsAr.meBookingsTitle, match: 'prefix' },
    ...(marketplaceOn
      ? [
          {
            href: '/empty-legs',
            label: emptyLegsAr.navList,
            match: 'prefix',
          } satisfies ClientNavItem,
        ]
      : []),
    ...(emptyLegAlertsOn
      ? [
          {
            href: '/me/empty-legs/alerts',
            label: clientsAr.navEmptyLegAlerts,
            match: 'prefix',
          } satisfies ClientNavItem,
        ]
      : []),
    { href: '/me/reviews', label: clientsAr.meReviewsTitle, match: 'prefix' },
    { href: '/me/support', label: supportAr.nav, match: 'prefix' },
    { href: '/me/referrals', label: referralsAr.nav, match: 'prefix' },
    ...(privilegeOn
      ? [
          {
            href: '/me/privilege',
            label: clientsAr.navPrivilege,
            match: 'prefix',
          } satisfies ClientNavItem,
        ]
      : []),
    {
      href: '/me/notifications',
      label: clientsAr.navNotifications,
      match: 'prefix',
    },
    { href: '/me/profile', label: clientsAr.navProfile, match: 'prefix' },
  ];
}

/**
 * Phase 9 PR 1 — authenticated client portal layout shell.
 * Server Component (reads feature flags) with client islands for the
 * active-link state, logout, and the mobile disclosure nav.
 */
export function ClientShell({ fullName, children }: ClientShellProps) {
  const links = buildClientNavLinks();

  return (
    <div dir="rtl" className="min-h-screen bg-navy">
      <header className="sticky top-0 z-40 border-b border-border bg-navy-secondary/85 pt-[env(safe-area-inset-top)] backdrop-blur-luxury">
        <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/me"
              className="font-ar shrink-0 tracking-tagged text-gold-light hover:text-gold"
            >
              {clientsAr.brand}
            </Link>
            <ClientNavLinks links={links} />
          </div>
          <div className="flex items-center gap-3">
            <span className="font-ar hidden text-xs text-ink-muted md:inline">
              {fullName}
            </span>
            <ClientLogoutButton className="font-ar hidden rounded-md border border-border bg-navy-card/60 px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light disabled:opacity-60 md:inline-flex" />
            <ClientMobileNav links={links} fullName={fullName} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
