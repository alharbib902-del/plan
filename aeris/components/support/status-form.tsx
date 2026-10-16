'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { updateTicketStatusAction, type SupportActionState } from '@/app/actions/support';
import { SUPPORT_STATUSES, SUPPORT_STATUS_LABELS } from '@/lib/support/validators';
import { supportAr } from '@/lib/i18n/support-ar';

const initialState: SupportActionState = { ok: false, message: '' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-gold/40 bg-gold/15 px-3 py-1 text-sm text-gold-light transition hover:bg-gold/25 disabled:opacity-50"
    >
      {pending ? supportAr.updating : supportAr.submitUpdate}
    </button>
  );
}

export function StatusForm({
  ticketId,
  currentStatus,
  currentResolution,
}: {
  ticketId: string;
  currentStatus: string;
  currentResolution?: string | null;
}) {
  const [state, formAction] = useActionState(updateTicketStatusAction, initialState);

  return (
    <form action={formAction} className="space-y-2" dir="rtl">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="status"
          defaultValue={currentStatus}
          className="rounded border border-border bg-navy-secondary/60 px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-gold/50"
        >
          {SUPPORT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SUPPORT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <SubmitButton />
        {state.message ? (
          <span className={state.ok ? 'text-sm text-emerald-300' : 'text-sm text-rose-300'}>
            {state.message}
          </span>
        ) : null}
      </div>
      <textarea
        name="resolution"
        rows={2}
        defaultValue={currentResolution ?? ''}
        placeholder={supportAr.resolutionPlaceholder}
        className="w-full rounded border border-border bg-navy-secondary/60 px-2 py-1 text-sm text-ink placeholder:text-ink-muted focus:border-gold/50"
      />
    </form>
  );
}
