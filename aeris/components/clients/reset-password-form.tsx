'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { clientVerifyPasswordReset } from '@/app/actions/clients-public';
import { ClientBanner, clientErrorMessage } from './error-banner';

interface ClientResetPasswordFormProps {
  token: string;
}

export function ClientResetPasswordForm({
  token,
}: ClientResetPasswordFormProps) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    startTransition(async () => {
      const result = await clientVerifyPasswordReset({
        token,
        new_password: String(fd.get('new_password') ?? ''),
      });
      if (result.ok) {
        setDone(true);
        return;
      }
      setErrorCode(result.error);
    });
  };

  if (done) {
    return (
      <div className="space-y-4">
        <ClientBanner kind="success">
          <p className="font-medium">{clientsAr.resetSuccessHeading}</p>
          <p className="mt-1 text-xs">{clientsAr.resetSuccessBody}</p>
        </ClientBanner>
        <Link
          href="/login"
          className="font-ar block w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-center text-sm font-medium text-gold-light transition-colors hover:bg-gold/25"
        >
          {clientsAr.resetGoToLogin}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}

      <div>
        <label
          htmlFor="new_password"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {clientsAr.resetNewPasswordLabel}
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
        {isPending ? clientsAr.resetSubmitting : clientsAr.resetSubmit}
      </button>
    </form>
  );
}
