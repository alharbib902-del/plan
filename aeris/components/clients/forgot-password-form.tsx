'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { clientRequestPasswordReset } from '@/app/actions/clients-public';
import { ClientBanner, clientErrorMessage } from './error-banner';

export function ClientForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    startTransition(async () => {
      const result = await clientRequestPasswordReset({
        email: String(fd.get('email') ?? ''),
      });
      if (result.ok) {
        setSubmitted(true);
        return;
      }
      setErrorCode(result.error);
    });
  };

  if (submitted) {
    return (
      <div className="space-y-4">
        <ClientBanner kind="success">
          {clientsAr.forgotOpaqueSuccess}
        </ClientBanner>
        <Link
          href="/login"
          className="font-ar block text-center text-xs text-gold-light hover:text-gold"
        >
          ← {clientsAr.forgotBackToLogin}
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
          htmlFor="email"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {clientsAr.forgotEmailLabel}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          required
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending ? clientsAr.forgotSubmitting : clientsAr.forgotSubmit}
      </button>

      <Link
        href="/login"
        className="font-ar block text-center text-xs text-ink-muted hover:text-gold-light"
      >
        ← {clientsAr.forgotBackToLogin}
      </Link>
    </form>
  );
}
