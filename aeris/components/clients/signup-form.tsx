'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { clientsAr } from '@/lib/i18n/clients-ar';
import {
  clientSignup,
  clientLogin,
} from '@/app/actions/clients-public';
import { ClientBanner, clientErrorMessage } from './error-banner';

export function ClientSignupForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string>
  >({});
  const [successView, setSuccessView] = useState(false);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') ?? '');
    const password = String(fd.get('password') ?? '');
    const full_name = String(fd.get('full_name') ?? '');
    const phone = String(fd.get('phone') ?? '');
    const marketing_opt_in = fd.get('marketing_opt_in') === 'on';

    setErrorCode(null);
    setFieldErrors({});
    startTransition(async () => {
      const signup = await clientSignup({
        email,
        password,
        full_name,
        phone,
        marketing_opt_in,
      });
      if (!signup.ok) {
        setErrorCode(signup.error);
        if (signup.field_errors) setFieldErrors(signup.field_errors);
        return;
      }
      // Auto-login on successful signup so the user lands
      // on /me without an extra step.
      const login = await clientLogin({
        email,
        password,
        remember_me: false,
      });
      if (!login.ok) {
        // Signup succeeded but auto-login failed (rare —
        // surface a soft success + redirect to login).
        setSuccessView(true);
        return;
      }
      setSuccessView(true);
      router.push('/me');
      router.refresh();
    });
  };

  if (successView) {
    return (
      <ClientBanner kind="success">
        <p className="font-medium">{clientsAr.signupSuccessHeading}</p>
        <p className="mt-1 text-xs">{clientsAr.signupSuccessBody}</p>
      </ClientBanner>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}

      <Field
        name="email"
        type="email"
        dir="ltr"
        label={clientsAr.signupEmailLabel}
        error={fieldErrors.email}
      />
      <Field
        name="password"
        type="password"
        dir="ltr"
        label={clientsAr.signupPasswordLabel}
        error={fieldErrors.password}
      />
      <Field
        name="full_name"
        type="text"
        label={clientsAr.signupFullNameLabel}
        error={fieldErrors.full_name}
      />
      <Field
        name="phone"
        type="tel"
        dir="ltr"
        label={clientsAr.signupPhoneLabel}
        error={fieldErrors.phone}
      />

      <label className="font-ar flex items-start gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          name="marketing_opt_in"
          className="mt-1 h-4 w-4 accent-gold"
        />
        <span>{clientsAr.signupMarketingOptIn}</span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending ? clientsAr.signupSubmitting : clientsAr.signupSubmit}
      </button>

      <p className="font-ar pt-2 text-center text-xs text-ink-muted">
        {clientsAr.signupHasAccountPrompt}{' '}
        <Link href="/login" className="text-gold-light hover:text-gold">
          {clientsAr.signupLoginLink}
        </Link>
      </p>
    </form>
  );
}

function Field({
  name,
  type,
  dir,
  label,
  error,
}: {
  name: string;
  type: string;
  dir?: 'ltr' | 'rtl';
  label: string;
  error?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        dir={dir}
        required
        className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
      />
      {error ? (
        <p className="font-ar mt-1 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
