'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import {
  ClientLogoutButton,
  isClientNavActive,
  type ClientNavItem,
} from './client-nav';

/**
 * Below md the portal's ~11 links used to wrap into a ~300px-tall
 * header at 320px width. This disclosure (modelled on
 * OperatorMobileNav) keeps the header one row tall; the panel scrolls
 * on its own so short/landscape screens can still reach every link.
 */
export function ClientMobileNav({
  links,
  fullName,
}: {
  links: ClientNavItem[];
  fullName: string;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? clientsAr.navMenuClose : clientsAr.navMenuOpen}
        aria-expanded={open}
        aria-controls="client-mobile-nav"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border text-gold-light"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div
          id="client-mobile-nav"
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-5rem)] overflow-y-auto border-t border-border bg-navy-secondary/95 backdrop-blur-luxury"
        >
          <nav
            aria-label={clientsAr.navMenuLabel}
            className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-4 sm:px-6"
          >
            {fullName ? (
              <p className="font-ar px-3 pb-2 text-xs text-ink-muted">
                {fullName}
              </p>
            ) : null}
            {links.map((item) => {
              const active = isClientNavActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={`font-ar flex min-h-[44px] items-center rounded-md px-3 py-2 text-base transition-colors ${
                    active
                      ? 'bg-navy-card text-gold-light'
                      : 'text-ink-secondary hover:bg-navy-card/60 hover:text-gold-light'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <ClientLogoutButton
              onDone={() => setOpen(false)}
              className="font-ar mt-2 flex min-h-[44px] items-center justify-center rounded-md border border-border bg-navy-card/60 px-3 py-2 text-base text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light disabled:opacity-60"
            />
          </nav>
        </div>
      )}
    </div>
  );
}
