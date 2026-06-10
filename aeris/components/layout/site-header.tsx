'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { whatsappLink } from '@/lib/utils/format';
import { AERIS_DEFAULT_WHATSAPP_MESSAGE } from '@/lib/config/contact';

const BASE_NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/#services', label: 'الخدمات' },
  { href: '/#why', label: 'لماذا Aeris' },
  { href: '/#contact', label: 'تواصل معنا' },
];

// Phase 7 PR 2d: nav entry for the public marketplace.
// `NEXT_PUBLIC_ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE` mirrors
// the server-side `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE`
// flag and is exposed to the browser only for the visual
// nav surface. The Server Actions + page modules still
// enforce the server-side flag — flipping the public flag
// alone will surface the link but produce a notFound() on
// click, by design.
const SHOW_EMPTY_LEGS_LINK =
  process.env.NEXT_PUBLIC_ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE === 'true';

const NAV_ITEMS: { href: string; label: string }[] = SHOW_EMPTY_LEGS_LINK
  ? [
      ...BASE_NAV_ITEMS,
      { href: '/empty-legs', label: 'رحلات فارغة' },
    ]
  : BASE_NAV_ITEMS;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelId = useId();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Close the mobile drawer on Escape + lock background scroll while it's
  // open (mirrors the admin/operator portal mobile-nav behavior).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'border-b border-border bg-navy-secondary/80 backdrop-blur-luxury'
          : 'border-b border-transparent bg-transparent'
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="Aeris"
          className="font-display text-2xl tracking-[0.28em] text-gold-light sm:text-3xl"
        >
          AERIS
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="font-ar text-sm text-ink-secondary transition-colors hover:text-gold"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href={whatsappLink(AERIS_DEFAULT_WHATSAPP_MESSAGE)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ar text-sm text-ink-secondary transition-colors hover:text-gold"
          >
            واتساب
          </Link>
          <Link
            href="/request"
            className="font-ar inline-flex items-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20"
          >
            اطلب رحلتك
          </Link>
        </div>

        <button
          type="button"
          aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border text-gold-light md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div id={panelId} className="border-t border-border bg-navy-secondary/95 backdrop-blur-luxury md:hidden">
          <nav className="flex flex-col gap-1 px-4 py-4 sm:px-6">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="font-ar rounded-md px-3 py-3 text-base text-ink-secondary transition-colors hover:bg-gold/5 hover:text-gold"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={whatsappLink(AERIS_DEFAULT_WHATSAPP_MESSAGE)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="font-ar rounded-md px-3 py-3 text-base text-ink-secondary transition-colors hover:bg-gold/5 hover:text-gold"
            >
              واتساب
            </Link>
            <Link
              href="/request"
              onClick={() => setOpen(false)}
              className="font-ar mt-2 inline-flex items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-3 text-base text-gold-light transition-all hover:border-gold hover:bg-gold/20"
            >
              اطلب رحلتك
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
