import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { OperatorLogoutButton } from './logout-button';

interface PortalShellProps {
  children: React.ReactNode;
  companyName: string;
}

export function OperatorPortalShell({
  children,
  companyName,
}: PortalShellProps) {
  return (
    <div className="min-h-screen bg-navy">
      <header className="sticky top-0 z-40 border-b border-border bg-navy-secondary/85 backdrop-blur-luxury">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/operator/dashboard" className="flex items-center gap-3" aria-label="Aeris">
              <span className="font-display text-xl tracking-[0.28em] text-gold-light">AERIS</span>
              <span className="font-ar rounded-full border border-border px-2.5 py-0.5 text-xs text-ink-muted">
                {companyName}
              </span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {[
                { href: '/operator/dashboard', label: operatorsAr.portal.nav.dashboard },
                { href: '/operator/empty-legs', label: operatorsAr.portal.nav.legs },
                { href: '/operator/bookings', label: operatorsAr.portal.nav.bookings },
                { href: '/operator/profile', label: operatorsAr.portal.nav.profile },
                { href: '/operator/earnings', label: operatorsAr.portal.nav.earnings },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="font-ar rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <OperatorLogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
