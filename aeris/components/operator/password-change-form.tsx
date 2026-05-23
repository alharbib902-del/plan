'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import { operatorChangePassword } from '@/app/actions/operators-public';
import { OperatorBanner, operatorErrorMessage } from './error-banner';
import { PasswordInput } from '@/components/ui/password-input';

const ar = operatorsAr.portal.password;

export function OperatorPasswordChangeForm({
  mustChange,
}: {
  mustChange: boolean;
}) {
  const router = useRouter();
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
      const result = await operatorChangePassword({
        current_password: mustChange ? '' : String(fd.get('current_password') ?? ''),
        new_password: String(fd.get('new_password') ?? ''),
        confirm_password: String(fd.get('confirm_password') ?? ''),
      });
      if (result.ok) {
        setSuccess(true);
        // After must-change redirect to dashboard.
        if (mustChange) setTimeout(() => router.push('/operator/dashboard'), 800);
      } else {
        setErrorCode(result.error);
        if (result.field_errors) setFieldErrors(result.field_errors);
      }
    });
  };

  if (success) return <OperatorBanner kind="success">{ar.successMessage}</OperatorBanner>;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {mustChange ? <OperatorBanner kind="warning">{ar.mustChangeNotice}</OperatorBanner> : null}
      {errorCode ? <OperatorBanner kind="error">{operatorErrorMessage(errorCode)}</OperatorBanner> : null}

      {!mustChange ? (
        <Field
          label={ar.labels.current_password}
          name="current_password"
          type="password"
          dir="ltr"
          error={fieldErrors.current_password}
          required
        />
      ) : null}
      <Field
        label={ar.labels.new_password}
        name="new_password"
        type="password"
        dir="ltr"
        error={fieldErrors.new_password}
        required
      />
      <Field
        label={ar.labels.confirm_password}
        name="confirm_password"
        type="password"
        dir="ltr"
        error={fieldErrors.confirm_password}
        required
      />
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
  error?: string;
  required?: boolean;
}) {
  const isPassword = props.type === 'password';
  const fieldClass = `font-ar w-full rounded-lg border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:outline-none ${
    props.error ? 'border-rose-500/60' : 'border-border focus:border-gold/50'
  }`;
  return (
    <div>
      <label className="font-ar mb-1 block text-xs text-ink-muted">{props.label}</label>
      {isPassword ? (
        <PasswordInput
          name={props.name}
          dir={props.dir}
          required={props.required}
          className={fieldClass}
        />
      ) : (
        <input
          name={props.name}
          type={props.type ?? 'text'}
          dir={props.dir}
          required={props.required}
          className={fieldClass}
        />
      )}
      {props.error ? <p className="font-ar mt-1 text-xs text-rose-200">{props.error}</p> : null}
    </div>
  );
}
