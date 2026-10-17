'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';

import {
  ShellNavLinks,
  type ShellNavItem,
} from '@/components/layout/shell-nav-links';

/**
 * Mobile/tablet disclosure nav for the operator portal. The shell is
 * a Server Component that builds the feature-flag-filtered link
 * array; this client child only owns the open/close UI so the
 * portal stays navigable below the lg breakpoint where the inline
 * <nav> is hidden. Mirrors the public SiteHeader drawer pattern
 * (44x44 hamburger, aria-expanded, Escape-to-close).
 */
export function OperatorMobileNav({ links }: { links: ShellNavItem[] }) {
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
    <div className="lg:hidden">
      <button
        type="button"
        aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border text-gold-light"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        // Capped to the viewport under the header so long flag-gated
        // lists scroll instead of running off-screen.
        <div className="absolute inset-x-0 top-full max-h-[calc(100svh-4.5rem-env(safe-area-inset-top))] overflow-y-auto overscroll-contain border-t border-border bg-navy-secondary/95 backdrop-blur-luxury">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8">
            <ShellNavLinks
              links={links}
              variant="menu"
              onNavigate={() => setOpen(false)}
            />
          </nav>
        </div>
      )}
    </div>
  );
}
