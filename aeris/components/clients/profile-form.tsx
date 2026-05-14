'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { clientUpdateProfile } from '@/app/actions/clients-public';
import { ClientBanner, clientErrorMessage } from './error-banner';

interface ClientProfileFormProps {
  initial: {
    full_name: string;
    contact_phone: string;
    auth_email: string;
    marketing_opt_in: boolean;
  };
}

export function ClientProfileForm({ initial }: ClientProfileFormProps) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    startTransition(async () => {
      const result = await clientUpdateProfile({
        full_name: String(fd.get('full_name') ?? ''),
        phone: String(fd.get('phone') ?? ''),
        marketing_opt_in: fd.get('marketing_opt_in') === 'on',
      });
      if (result.ok) {
        setSavedAt(Date.now());
        return;
      }
      setErrorCode(result.error);
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}
      {savedAt && !errorCode ? (
        <ClientBanner kind="success">
          {clientsAr.profileSavedToast}
        </ClientBanner>
      ) : null}

      <div>
        <label className="font-ar mb-1 block text-xs text-ink-muted">
          {clientsAr.profileEmailLabel}
        </label>
        <input
          type="email"
          dir="ltr"
          readOnly
          defaultValue={initial.auth_email}
          className="font-ar w-full cursor-not-allowed rounded-lg border border-border bg-navy-secondary/30 px-3 py-2 text-sm text-ink-muted"
        />
      </div>

      <div>
        <label
          htmlFor="full_name"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {clientsAr.profileFullNameLabel}
        </label>
        <input
          id="full_name"
          name="full_name"
          type="text"
          required
          defaultValue={initial.full_name}
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>

      <div>
        <label
          htmlFor="phone"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {clientsAr.profilePhoneLabel}
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          dir="ltr"
          required
          defaultValue={initial.contact_phone}
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
        />
      </div>

      <label className="font-ar flex items-start gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          name="marketing_opt_in"
          defaultChecked={initial.marketing_opt_in}
          className="mt-1 h-4 w-4 accent-gold"
        />
        <span>{clientsAr.profileMarketingOptIn}</span>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending ? clientsAr.profileSaving : clientsAr.profileSave}
      </button>
    </form>
  );
}
