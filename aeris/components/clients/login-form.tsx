'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { clientLogin } from '@/app/actions/clients-public';
import { ClientBanner, clientErrorMessage } from './error-banner';

export function ClientLoginForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    startTransition(async () => {
      const result = await clientLogin({
        email: String(fd.get('email') ?? ''),
        password: String(fd.get('password') ?? ''),
        remember_me: fd.get('remember_me') === 'on',
      });
      if (result.ok) {
        router.push('/me');
        router.refresh();
      } else {
        setErrorCode(result.error);
      }
    });
  };

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
          {clientsAr.loginEmailLabel}
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
      <div>
        <label
          htmlFor="password"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {clientsAr.loginPasswordLabel}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          required
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>
      <label className="font-ar flex items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          name="remember_me"
          className="h-4 w-4 accent-gold"
        />
        {clientsAr.loginRememberMe}
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending ? clientsAr.loginSubmitting : clientsAr.loginSubmit}
      </button>

      <div className="font-ar flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-ink-muted">
        <Link href="/forgot-password" className="hover:text-gold-light">
          {clientsAr.loginForgotLink}
        </Link>
        <span>
          {clientsAr.loginNoAccountPrompt}{' '}
          <Link href="/signup" className="text-gold-light hover:text-gold">
            {clientsAr.loginSignupLink}
          </Link>
        </span>
      </div>
    </form>
  );
}
