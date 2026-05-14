'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { clientChangePassword } from '@/app/actions/clients-public';
import { ClientBanner, clientErrorMessage } from './error-banner';

export function ClientChangePasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    setDone(false);
    startTransition(async () => {
      const result = await clientChangePassword({
        current_password: String(fd.get('current_password') ?? ''),
        new_password: String(fd.get('new_password') ?? ''),
      });
      if (result.ok) {
        setDone(true);
        return;
      }
      setErrorCode(result.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}
      {done ? (
        <ClientBanner kind="success">
          {clientsAr.changePasswordSuccess}
        </ClientBanner>
      ) : null}

      <div>
        <label
          htmlFor="current_password"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {clientsAr.changePasswordCurrentLabel}
        </label>
        <input
          id="current_password"
          name="current_password"
          type="password"
          dir="ltr"
          required
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="new_password"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {clientsAr.changePasswordNewLabel}
        </label>
        <input
          id="new_password"
          name="new_password"
          type="password"
          dir="ltr"
          required
          minLength={10}
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending
          ? clientsAr.changePasswordSubmitting
          : clientsAr.changePasswordSubmit}
      </button>
    </form>
  );
}
