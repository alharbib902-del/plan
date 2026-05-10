'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorVerifyOtp } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';

const ar = operatorsAr.portal.otp;

export function OperatorOtpForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    startTransition(async () => {
      const result = await operatorVerifyOtp({
        email: String(fd.get('email') ?? ''),
        code: String(fd.get('code') ?? ''),
      });
      if (result.ok) {
        router.push('/operator/dashboard');
        router.refresh();
      } else {
        const map: Record<string, string> = {
          no_active_otp: 'otp_no_active',
          code_mismatch: 'otp_mismatch',
          expired: 'otp_expired',
          locked: 'otp_locked',
        };
        setErrorCode(map[result.error] ?? result.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner>
      ) : null}
      <p className="font-ar text-sm text-ink-muted">{ar.subtitle}</p>
      <div>
        <label className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.email}</label>
        <input
          name="email"
          type="email"
          dir="ltr"
          required
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>
      <div>
        <label className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.code}</label>
        <input
          name="code"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          dir="ltr"
          className="w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-center font-mono text-lg tracking-widest text-ink-primary focus:border-gold/50 focus:outline-none"
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
