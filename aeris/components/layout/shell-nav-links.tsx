'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { resolveActiveNavHref } from '@/lib/utils/active-nav-href';

export interface ShellNavItem {
  href: string;
  label: string;
}

const VARIANT_CLASSES = {
  // Inset focus ring: the bar sits in an overflow-x-auto strip that
  // would clip the default outset outline.
  bar: 'inline-flex min-h-11 shrink-0 items-center whitespace-nowrap px-3 text-sm focus-visible:outline-offset-[-2px]',
  menu: 'block px-3 py-3 text-base',
} as const;

/**
 * Nav links for the server-rendered admin/operator shells. Lives in a
 * client component only because the active state needs usePathname().
 */
export function ShellNavLinks({
  links,
  variant,
  onNavigate,
}: {
  links: readonly ShellNavItem[];
  variant: keyof typeof VARIANT_CLASSES;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? '';
  const activeHref = resolveActiveNavHref(
    pathname,
    links.map((item) => item.href)
  );

  return (
    <>
      {links.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`font-ar rounded-md transition-colors ${VARIANT_CLASSES[variant]} ${
              active
                ? 'bg-navy-card text-gold-light'
                : 'text-ink-secondary hover:bg-navy-card/60 hover:text-gold-light'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
