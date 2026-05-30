'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { SupportActionState } from '@/app/actions/support';
import { supportAr } from '@/lib/i18n/support-ar';

const initialState: SupportActionState = { ok: false, message: '' };

type ReplyAction = (
  prevState: SupportActionState,
  formData: FormData
) => Promise<SupportActionState>;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-gold px-4 py-2 font-medium text-navy transition hover:bg-gold-dark hover:text-white disabled:opacity-50"
    >
      {pending ? supportAr.submitting : supportAr.submitReply}
    </button>
  );
}

export function ReplyForm({
  ticketId,
  action,
}: {
  ticketId: string;
  action: ReplyAction;
}) {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="space-y-3" dir="rtl">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <div>
        <label htmlFor={`body-${ticketId}`} className="block text-sm font-medium text-navy">
          {supportAr.fieldReply}
        </label>
        <textarea
          id={`body-${ticketId}`}
          name="body"
          rows={3}
          required
          className="mt-1 w-full rounded-md border border-secondary px-3 py-2 text-navy"
        />
        {state.errors?.body ? (
          <p className="mt-1 text-sm text-red-600">{state.errors.body[0]}</p>
        ) : null}
      </div>

      {state.message ? (
        <p className={state.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
