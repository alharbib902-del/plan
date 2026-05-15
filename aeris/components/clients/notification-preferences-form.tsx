'use client';

import { useState, useTransition } from 'react';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { updateMyNotificationPreferences } from '@/app/actions/clients-empty-legs';

import { ClientBanner, clientErrorMessage } from './error-banner';

/**
 * Phase 10 PR 2 — `/me/notifications` preferences form.
 *
 * Wraps updateMyNotificationPreferences Server Action (PR 1).
 * Strict shape per §3.3 schema:
 *   { empty_legs: { email: boolean, wa_link: boolean }, marketing: boolean }
 *
 * Default state passed in from the page server component
 * (reads clients.notification_preferences via getClientForSession).
 * Missing keys default to opt-in (Decision #4) — handled in the
 * page's getInitialPrefs, so this component receives a fully-
 * populated shape.
 */

interface NotificationPreferencesFormProps {
  initialPrefs: {
    empty_legs: { email: boolean; wa_link: boolean };
    marketing: boolean;
  };
}

export function NotificationPreferencesForm({
  initialPrefs,
}: NotificationPreferencesFormProps) {
  const [emptyLegsEmail, setEmptyLegsEmail] = useState(
    initialPrefs.empty_legs.email
  );
  const [emptyLegsWaLink, setEmptyLegsWaLink] = useState(
    initialPrefs.empty_legs.wa_link
  );
  const [marketing, setMarketing] = useState(initialPrefs.marketing);
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorCode(null);
    startTransition(async () => {
      const result = await updateMyNotificationPreferences({
        empty_legs: {
          email: emptyLegsEmail,
          wa_link: emptyLegsWaLink,
        },
        marketing,
      });
      if (!result.ok) {
        setErrorCode(result.error);
        return;
      }
      setSavedAt(Date.now());
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {errorCode ? (
        <ClientBanner kind="error">
          {emptyLegErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}

      {savedAt ? (
        <ClientBanner kind="success">
          <p>{clientsAr.notificationsSavedToast}</p>
        </ClientBanner>
      ) : null}

      <fieldset className="space-y-3 rounded-xl border border-border bg-navy-card/40 p-5">
        <legend className="font-ar px-2 text-sm font-medium text-ink">
          {clientsAr.notificationsCategoryEmptyLegs}
        </legend>
        <Toggle
          id="empty_legs_email"
          label={clientsAr.notificationsChannelEmail}
          checked={emptyLegsEmail}
          onChange={setEmptyLegsEmail}
        />
        <Toggle
          id="empty_legs_wa_link"
          label={clientsAr.notificationsChannelWaLink}
          checked={emptyLegsWaLink}
          onChange={setEmptyLegsWaLink}
        />
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-border bg-navy-card/40 p-5">
        <legend className="font-ar px-2 text-sm font-medium text-ink">
          {clientsAr.notificationsCategoryMarketing}
        </legend>
        <Toggle
          id="marketing"
          label={clientsAr.notificationsCategoryMarketing}
          checked={marketing}
          onChange={setMarketing}
        />
      </fieldset>

      <button
        type="submit"
        disabled={isPending}
        className="font-ar rounded-lg border border-gold/50 bg-gold/15 px-5 py-2.5 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending
          ? clientsAr.notificationsSaving
          : clientsAr.notificationsSaveCta}
      </button>
    </form>
  );
}

interface ToggleProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function Toggle({ id, label, checked, onChange }: ToggleProps) {
  return (
    <label
      htmlFor={id}
      className="font-ar flex items-center justify-between gap-3 text-sm text-ink"
    >
      <span>{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-border bg-navy-secondary text-gold accent-gold focus:ring-2 focus:ring-gold/40"
      />
    </label>
  );
}

function emptyLegErrorMessage(code: string): string {
  const map = clientsAr.emptyLegsErrors;
  if (Object.prototype.hasOwnProperty.call(map, code)) {
    return map[code]!;
  }
  return clientErrorMessage(code);
}
