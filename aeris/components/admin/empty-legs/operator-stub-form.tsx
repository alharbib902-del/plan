'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminCreatePhase7OperatorStub } from '@/app/actions/phase7-operator-stubs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { translateEmptyLegError } from './error-translator';

export function OperatorStubForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSuccess(false);

    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const companyName = String(form.get('company_name') ?? '').trim();
    const contactEmailRaw = String(form.get('contact_email') ?? '').trim();
    const contactPhoneRaw = String(form.get('contact_phone') ?? '').trim();
    const notesRaw = String(form.get('notes') ?? '').trim();

    startTransition(async () => {
      const result = await adminCreatePhase7OperatorStub({
        company_name: companyName,
        contact_email: contactEmailRaw.length > 0 ? contactEmailRaw : null,
        contact_phone: contactPhoneRaw.length > 0 ? contactPhoneRaw : null,
        notes: notesRaw.length > 0 ? notesRaw : null,
      });
      if (result.ok) {
        setSuccess(true);
        formEl.reset();
        router.refresh();
        return;
      }
      setError(translateEmptyLegError(result.error));
      setFieldErrors(result.field_errors ?? {});
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={emptyLegsAr.adminStubsFieldCompanyName}
          name="company_name"
          error={fieldErrors.company_name}
          required
        >
          <input
            id="company_name"
            name="company_name"
            type="text"
            required
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.adminStubsFieldContactEmail}
          name="contact_email"
          error={fieldErrors.contact_email}
        >
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            dir="ltr"
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.adminStubsFieldContactPhone}
          name="contact_phone"
          error={fieldErrors.contact_phone}
        >
          <input
            id="contact_phone"
            name="contact_phone"
            type="tel"
            dir="ltr"
            className={inputCls}
          />
        </Field>
      </div>
      <div>
        <label
          htmlFor="notes"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {emptyLegsAr.adminStubsFieldNotes}
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className={`${inputCls} resize-y`}
        />
      </div>
      {error ? (
        <p className="font-ar text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          className="font-ar text-xs text-emerald-200"
          role="status"
        >
          ✓
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-1.5 text-sm text-gold-light transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? emptyLegsAr.formSubmitting
            : emptyLegsAr.adminStubsSubmit}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none';

function Field({
  label,
  name,
  error,
  required,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {label}
        {required ? <span className="text-red-300"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p
          className="font-ar mt-1 text-xs text-red-300"
          role="alert"
        >
          {translateEmptyLegError(error)}
        </p>
      ) : null}
    </div>
  );
}
