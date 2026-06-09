'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Menu, X } from 'lucide-react';

interface NavLink {
  href: string;
  label: string;
}

/**
 * Mobile disclosure nav for the admin shell. AdminShell is a
 * Server Component that resolves the env-flag-gated link array;
 * this client child only owns the open/close UI so the team
 * dashboard stays navigable below the sm breakpoint where the
 * inline <nav> is hidden. Mirrors the public SiteHeader drawer
 * pattern (40x40 hamburger, aria-expanded, Escape-to-close).
 */
export function AdminMobileNav({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    // Lock background scroll while the overlay panel is open.
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-gold-light"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div id={panelId} className="absolute inset-x-0 top-full border-t border-border bg-navy-secondary/95 backdrop-blur-luxury">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 sm:px-6 lg:px-8">
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="font-ar rounded-md px-3 py-3 text-base text-ink-secondary transition-colors hover:bg-navy-card/60 hover:text-gold-light"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
