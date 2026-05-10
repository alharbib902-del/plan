'use client';

import { useState, useTransition } from 'react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorSignup } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';

const ar = operatorsAr.portal.signup;

export function OperatorSignupForm() {
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
      const result = await operatorSignup({
        email: String(fd.get('email') ?? ''),
        password: String(fd.get('password') ?? ''),
        company_name: String(fd.get('company_name') ?? ''),
        contact_email: String(fd.get('contact_email') ?? ''),
        contact_phone: String(fd.get('contact_phone') ?? ''),
        notes: String(fd.get('notes') ?? '') || null,
      });
      if (result.ok) {
        setSuccess(true);
      } else {
        setErrorCode(result.error);
        if (result.field_errors) setFieldErrors(result.field_errors);
      }
    });
  };

  if (success) {
    return <OperatorBanner kind="success">{ar.pendingMessage}</OperatorBanner>;
  }

  if (errorCode === 'rate_limited') {
    return (
      <OperatorBanner kind="warning">
        <p className="mb-2 font-medium">{ar.rateLimitedHeading}</p>
        <p>{ar.rateLimitedBody}</p>
      </OperatorBanner>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner>
      ) : null}

      <Field label={ar.labels.email} name="email" type="email" dir="ltr" error={fieldErrors.email} required />
      <Field
        label={ar.labels.password}
        name="password"
        type="password"
        dir="ltr"
        error={fieldErrors.password}
        hint={ar.passwordHint}
        required
      />
      <Field label={ar.labels.company_name} name="company_name" error={fieldErrors.company_name} required />
      <Field
        label={ar.labels.contact_email}
        name="contact_email"
        type="email"
        dir="ltr"
        error={fieldErrors.contact_email}
        hint={ar.contactEmailHint}
        required
      />
      <Field label={ar.labels.contact_phone} name="contact_phone" dir="ltr" error={fieldErrors.contact_phone} required />
      <div>
        <label className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.notes}</label>
        <textarea
          name="notes"
          rows={3}
          className="font-ar w-full resize-none rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
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

function Field({
  label,
  name,
  type = 'text',
  dir,
  error,
  hint,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  dir?: 'ltr' | 'rtl';
  error?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="font-ar mb-1 block text-xs text-ink-muted">{label}</label>
      <input
        name={name}
        type={type}
        dir={dir}
        required={required}
        className={`font-ar w-full rounded-lg border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:outline-none ${
          error ? 'border-rose-500/60' : 'border-border focus:border-gold/50'
        }`}
      />
      {error ? <p className="font-ar mt-1 text-xs text-rose-200">{error}</p> : null}
      {!error && hint ? <p className="font-ar mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
