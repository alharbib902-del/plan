'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorLogin } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';
import { PasswordInput } from '@/components/ui/password-input';

const ar = operatorsAr.portal.login;

export function OperatorLoginForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    startTransition(async () => {
      const result = await operatorLogin({
        email: String(fd.get('email') ?? ''),
        password: String(fd.get('password') ?? ''),
        remember_me: fd.get('remember_me') === 'on',
      });
      if (result.ok) {
        router.push(result.password_must_change ? '/operator/profile/password' : '/operator/dashboard');
        router.refresh();
      } else {
        setErrorCode(result.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner>
      ) : null}

      <div>
        <label htmlFor="email" className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.email}</label>
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
        <label htmlFor="password" className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.password}</label>
        <PasswordInput
          id="password"
          name="password"
          dir="ltr"
          required
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>
      <label className="font-ar flex items-center gap-2 text-sm text-ink-secondary">
        <input type="checkbox" name="remember_me" className="h-4 w-4 accent-gold" />
        {ar.labels.rememberMe}
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending ? '…' : ar.submit}
      </button>

      <div className="font-ar flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-ink-muted">
        <Link href="/operator/forgot-password" className="hover:text-gold-light">
          {ar.forgotPassword}
        </Link>
        <Link href="/operator/login/otp" className="hover:text-gold-light">
          {ar.otpFallback}
        </Link>
        <Link href="/operator/signup" className="hover:text-gold-light">
          {ar.signupCta}
        </Link>
      </div>
    </form>
  );
}
