'use client';

import { useState, useTransition } from 'react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorUpdateProfile } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';

const ar = operatorsAr.portal.profile;

export function OperatorProfileEditForm({
  initialCompanyName,
  initialContactEmail,
  initialContactPhone,
  authEmail,
}: {
  initialCompanyName: string;
  initialContactEmail: string;
  initialContactPhone: string;
  authEmail: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    setFieldErrors({});
    setSuccess(false);
    startTransition(async () => {
      const result = await operatorUpdateProfile({
        company_name: String(fd.get('company_name') ?? ''),
        contact_email: String(fd.get('contact_email') ?? ''),
        contact_phone: String(fd.get('contact_phone') ?? ''),
      });
      if (result.ok) setSuccess(true);
      else {
        setErrorCode(result.error);
        if (result.field_errors) setFieldErrors(result.field_errors);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {success ? <OperatorBanner kind="success">{ar.updateSuccess}</OperatorBanner> : null}
      {errorCode ? <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner> : null}

      <div>
        <label className="font-ar mb-1 block text-xs text-ink-muted">{ar.labels.auth_email}</label>
        <input
          dir="ltr"
          value={authEmail}
          disabled
          className="w-full cursor-not-allowed rounded-lg border border-border/40 bg-navy-secondary/30 px-3 py-2 text-sm text-ink-muted"
        />
        <p className="font-ar mt-1 text-xs text-ink-muted">{ar.authEmailHint}</p>
      </div>

      <Field label={ar.labels.company_name} name="company_name" defaultValue={initialCompanyName} error={fieldErrors.company_name} required />
      <Field label={ar.labels.contact_email} name="contact_email" type="email" dir="ltr" defaultValue={initialContactEmail} error={fieldErrors.contact_email} required />
      <Field label={ar.labels.contact_phone} name="contact_phone" dir="ltr" defaultValue={initialContactPhone} error={fieldErrors.contact_phone} required />

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

function Field(props: {
  label: string;
  name: string;
  type?: string;
  dir?: 'ltr' | 'rtl';
  defaultValue?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={props.name} className="font-ar mb-1 block text-xs text-ink-muted">{props.label}</label>
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? 'text'}
        dir={props.dir}
        defaultValue={props.defaultValue}
        required={props.required}
        className={`font-ar w-full rounded-lg border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:outline-none ${
          props.error ? 'border-rose-500/60' : 'border-border focus:border-gold/50'
        }`}
      />
      {props.error ? <p className="font-ar mt-1 text-xs text-rose-200">{props.error}</p> : null}
    </div>
  );
}
