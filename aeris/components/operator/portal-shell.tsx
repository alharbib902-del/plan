import Link from 'next/link';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { ShellNavLinks } from '@/components/layout/shell-nav-links';
import { OperatorLogoutButton } from './logout-button';
import { OperatorMobileNav } from './operator-mobile-nav';

interface PortalShellProps {
  children: React.ReactNode;
  companyName: string;
}

export function OperatorPortalShell({
  children,
  companyName,
}: PortalShellProps) {
  const navLinks = [
    { href: '/operator/dashboard', label: operatorsAr.portal.nav.dashboard },
    { href: '/operator/legs', label: operatorsAr.portal.nav.legs },
    { href: '/operator/fleet', label: operatorsAr.portal.nav.fleet },
    { href: '/operator/crew', label: operatorsAr.portal.nav.crew },
    // Phase 11 PR 2 — gated cargo nav links. Same
    // ENABLE_CARGO === 'true' (fail-closed) discipline as
    // the admin-shell + /operator/cargo pages themselves.
    ...(process.env.ENABLE_CARGO === 'true'
      ? [
          { href: '/operator/cargo', label: 'الشحن' },
          { href: '/operator/cargo/offers', label: 'عروضي للشحن' },
        ]
      : []),
    { href: '/operator/bookings', label: operatorsAr.portal.nav.bookings },
    { href: '/operator/profile', label: operatorsAr.portal.nav.profile },
    { href: '/operator/earnings', label: operatorsAr.portal.nav.earnings },
  ];

  return (
    <div className="min-h-screen bg-navy">
      <header className="sticky top-0 z-40 border-b border-border bg-navy-secondary/85 pt-[env(safe-area-inset-top)] backdrop-blur-luxury">
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-6">
            <Link href="/operator/dashboard" className="flex shrink-0 items-center gap-3" aria-label="Aeris">
              <span className="font-display text-xl tracking-[0.28em] text-gold-light">AERIS</span>
              <span
                title={companyName}
                className="font-ar hidden max-w-[10rem] truncate rounded-full border border-border px-2.5 py-0.5 text-xs text-ink-muted sm:inline-block"
              >
                {companyName}
              </span>
            </Link>
            <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto lg:flex">
              <ShellNavLinks links={navLinks} variant="bar" />
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <OperatorLogoutButton />
            <OperatorMobileNav links={navLinks} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
