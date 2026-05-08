'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { cancelMyReservation } from '@/app/actions/empty-legs-public';
import { translateEmptyLegError } from '@/components/admin/empty-legs/error-translator';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

export function ReservedActions({
  legNumber,
  reservationToken,
  whatsappUrl,
}: {
  legNumber: string;
  reservationToken: string;
  whatsappUrl: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelMyReservation({
        leg_number: legNumber,
        reservation_token: reservationToken,
      });
      if (result.ok) {
        setCancelled(true);
        router.refresh();
        return;
      }
      setError(translateEmptyLegError(result.error));
    });
  }

  if (cancelled) {
    return (
      <p className="font-ar rounded-md border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
        {emptyLegsAr.publicReservedCancelled}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
      <a
        href={whatsappUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-5 py-3 text-base text-emerald-200 transition-colors hover:bg-emerald-500/15"
      >
        {emptyLegsAr.publicReservedCallUs}
      </a>
      <button
        type="button"
        onClick={handleCancel}
        disabled={isPending}
        className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-red-400/40 bg-red-500/10 px-5 py-3 text-base text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending
          ? emptyLegsAr.formSubmitting
          : emptyLegsAr.publicReservedCancelButton}
      </button>
      {error ? (
        <p className="font-ar text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
