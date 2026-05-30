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
      className="rounded bg-navy px-3 py-1 text-sm text-white transition hover:bg-navy-tertiary disabled:opacity-50"
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
          className="rounded border border-secondary px-2 py-1 text-sm text-navy"
        >
          {SUPPORT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {SUPPORT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <SubmitButton />
        {state.message ? (
          <span className={state.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
            {state.message}
          </span>
        ) : null}
      </div>
      <textarea
        name="resolution"
        rows={2}
        defaultValue={currentResolution ?? ''}
        placeholder={supportAr.resolutionPlaceholder}
        className="w-full rounded border border-secondary px-2 py-1 text-sm text-navy"
      />
    </form>
  );
}
