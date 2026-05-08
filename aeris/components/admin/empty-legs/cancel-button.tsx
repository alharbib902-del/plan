'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminCancel } from '@/app/actions/empty-legs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { translateEmptyLegError } from './error-translator';

export function CancelLegButton({ legId }: { legId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const reasonRaw = form.get('reason');
    const reason =
      typeof reasonRaw === 'string' && reasonRaw.trim().length > 0
        ? reasonRaw.trim()
        : null;

    startTransition(async () => {
      const result = await adminCancel({ leg_id: legId, reason });
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(translateEmptyLegError(result.error));
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-border bg-navy-secondary/40 p-4"
    >
      <h3 className="font-ar mb-2 text-sm text-ink">
        {emptyLegsAr.cancelFormTitle}
      </h3>
      <p className="font-ar mb-3 text-xs text-ink-muted">
        {emptyLegsAr.cancelFormHint}
      </p>
      <label
        htmlFor="reason"
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {emptyLegsAr.cancelFieldReason}
      </label>
      <textarea
        id="reason"
        name="reason"
        rows={2}
        className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
      />
      {error ? (
        <p className="font-ar mt-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-red-400/40 bg-red-500/10 px-4 py-1.5 text-sm text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? emptyLegsAr.formSubmitting
            : emptyLegsAr.cancelSubmit}
        </button>
      </div>
    </form>
  );
}
