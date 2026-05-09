'use client';

import { useState, useTransition } from 'react';

import { confirmOptOut } from '@/app/actions/empty-legs-public';
import { translateEmptyLegError } from '@/components/admin/empty-legs/error-translator';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export function OptOutConfirmButton({ token }: { token: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await confirmOptOut({ opt_out_token: token });
      if (result.ok) {
        setDone(true);
        return;
      }
      setError(translateEmptyLegError(result.error));
    });
  }

  if (done) {
    return (
      <p
        role="status"
        className="font-ar rounded-md border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
      >
        {emptyLegsAr.publicOptOutDone}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-red-400/40 bg-red-500/10 px-5 py-3 text-base text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending
          ? emptyLegsAr.formSubmitting
          : emptyLegsAr.publicOptOutConfirmCta}
      </button>
      {error ? (
        <p
          className="font-ar rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
