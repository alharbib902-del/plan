'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { clientLogout } from '@/app/actions/clients-public';

export interface ClientNavItem {
  href: string;
  label: string;
  /** 'exact' for the /me landing; everything else owns its subtree. */
  match: 'exact' | 'prefix';
}

export function isClientNavActive(
  pathname: string,
  item: ClientNavItem
): boolean {
  if (item.match === 'exact') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Inline (md+) portal nav; the mobile disclosure lives in client-mobile-nav. */
export function ClientNavLinks({ links }: { links: ClientNavItem[] }) {
  const pathname = usePathname() ?? '';
  return (
    <nav
      aria-label={clientsAr.navMenuLabel}
      className="hidden flex-wrap items-center gap-x-1 gap-y-2 text-sm md:flex"
    >
      {links.map((item) => {
        const active = isClientNavActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`font-ar rounded-md px-3 py-1.5 transition-colors ${
              active
                ? 'bg-navy-card text-gold-light'
                : 'text-ink-secondary hover:bg-navy-card/60 hover:text-gold-light'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ClientLogoutButton({
  className,
  onDone,
}: {
  className: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onLogout = () => {
    startTransition(async () => {
      await clientLogout();
      onDone?.();
      router.push('/login');
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={isPending}
      className={className}
    >
      {clientsAr.navLogout}
    </button>
  );
}
