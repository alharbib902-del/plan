'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createSupportTicketAction, type SupportActionState } from '@/app/actions/support';
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS } from '@/lib/support/validators';
import { supportAr } from '@/lib/i18n/support-ar';

const initialState: SupportActionState = { ok: false, message: '' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gold px-4 py-2 font-medium text-navy transition hover:bg-gold-dark hover:text-white disabled:opacity-50"
    >
      {pending ? supportAr.submitting : supportAr.submitOpen}
    </button>
  );
}

export function TicketForm() {
  const [state, formAction] = useActionState(createSupportTicketAction, initialState);

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-ink">
          {supportAr.fieldCategory}
        </label>
        <select
          id="category"
          name="category"
          defaultValue="other"
          className="mt-1 w-full rounded-md border border-border bg-navy-secondary/60 px-3 py-2 text-ink placeholder:text-ink-muted focus:border-gold/50"
        >
          {SUPPORT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {SUPPORT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        {state.errors?.category ? (
          <p className="mt-1 text-sm text-rose-300">{state.errors.category[0]}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-ink">
          {supportAr.fieldSubject}
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          className="mt-1 w-full rounded-md border border-border bg-navy-secondary/60 px-3 py-2 text-ink placeholder:text-ink-muted focus:border-gold/50"
        />
        {state.errors?.subject ? (
          <p className="mt-1 text-sm text-rose-300">{state.errors.subject[0]}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-ink">
          {supportAr.fieldDescription}
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          required
          className="mt-1 w-full rounded-md border border-border bg-navy-secondary/60 px-3 py-2 text-ink placeholder:text-ink-muted focus:border-gold/50"
        />
        {state.errors?.description ? (
          <p className="mt-1 text-sm text-rose-300">{state.errors.description[0]}</p>
        ) : null}
      </div>

      {state.message ? (
        <p className={state.ok ? 'text-sm text-emerald-300' : 'text-sm text-rose-300'}>
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
