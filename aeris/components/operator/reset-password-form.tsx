'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorVerifyPasswordReset } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';
import { PasswordInput } from '@/components/ui/password-input';

const ar = operatorsAr.portal.resetPassword;

export function OperatorResetPasswordForm({ rawToken }: { rawToken: string }) {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await operatorVerifyPasswordReset({
        raw_token: rawToken,
        new_password: String(fd.get('new_password') ?? ''),
        confirm_password: String(fd.get('confirm_password') ?? ''),
      });
      if (result.ok) setSuccess(true);
      else {
        setErrorCode(result.error);
        if (result.field_errors) setFieldErrors(result.field_errors);
      }
    });
  };

  if (success) {
    return (
      <OperatorBanner kind="success">
        <p>{ar.successMessage}</p>
        <Link
          href="/operator/login"
          className="font-ar mt-2 inline-block text-emerald-300 underline hover:text-emerald-200"
        >
          {operatorsAr.portal.login.submit}
        </Link>
      </OperatorBanner>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner>
      ) : null}
      <div>
        <label htmlFor="new_password" className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.new_password}</label>
        <PasswordInput
          id="new_password"
          name="new_password"
          dir="ltr"
          required
          className={`font-ar w-full rounded-lg border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:outline-none ${
            fieldErrors.new_password ? 'border-rose-500/60' : 'border-border focus:border-gold/50'
          }`}
        />
        {fieldErrors.new_password ? (
          <p className="font-ar mt-1 text-xs text-rose-200">{fieldErrors.new_password}</p>
        ) : null}
      </div>
      <div>
        <label htmlFor="confirm_password" className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.confirm_password}</label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          dir="ltr"
          required
          className={`font-ar w-full rounded-lg border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:outline-none ${
            fieldErrors.confirm_password ? 'border-rose-500/60' : 'border-border focus:border-gold/50'
          }`}
        />
        {fieldErrors.confirm_password ? (
          <p className="font-ar mt-1 text-xs text-rose-200">{fieldErrors.confirm_password}</p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending ? '…' : ar.submit}
      </button>
    </form>
  );
}
