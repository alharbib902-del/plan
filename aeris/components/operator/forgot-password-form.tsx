'use client';

import { useState, useTransition } from 'react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorRequestPasswordReset } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';

const ar = operatorsAr.portal.forgotPassword;

export function OperatorForgotPasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    startTransition(async () => {
      const result = await operatorRequestPasswordReset({
        email: String(fd.get('email') ?? ''),
      });
      if (result.ok) setSuccess(true);
      else setErrorCode(result.error);
    });
  };

  if (success) {
    return <OperatorBanner kind="success">{ar.successMessage}</OperatorBanner>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner>
      ) : null}
      <div>
        <label htmlFor="email" className="font-ar mb-1 block text-xs text-ink-muted">{ar.label}</label>
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
        {isPending ? '…' : ar.submit}
      </button>
    </form>
  );
}
