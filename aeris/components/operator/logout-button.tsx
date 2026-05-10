'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorLogout } from '@/app/actions/operators-public';

export function OperatorLogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onClick = () => {
    startTransition(async () => {
      await operatorLogout();
      router.push('/operator/login');
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="font-ar inline-flex items-center gap-2 rounded-md border border-border bg-navy-card/60 px-4 py-2 text-sm text-ink-secondary transition-all hover:border-gold/40 hover:text-gold-light disabled:opacity-60"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {operatorsAr.portal.nav.logout}
    </button>
  );
}
