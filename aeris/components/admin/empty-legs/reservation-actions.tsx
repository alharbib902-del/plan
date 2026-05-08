'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  adminConfirmReservation,
  adminReleaseReservation,
} from '@/app/actions/empty-legs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { translateEmptyLegError } from './error-translator';

interface Props {
  legId: string;
  customerName: string | null;
  customerPhone: string | null;
  expiresAt: string | null;
}

export function ReservationActions({
  legId,
  customerName,
  customerPhone,
  expiresAt,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showConfirmInput, setShowConfirmInput] = useState(false);

  const waUrl = customerPhone
    ? `https://wa.me/${customerPhone.replace(/[^0-9]/g, '')}`
    : null;

  function handleConfirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const token = String(form.get('reservation_token') ?? '').trim();
    if (!token) {
      setError(translateEmptyLegError('reservation_token_invalid'));
      return;
    }
    startTransition(async () => {
      const result = await adminConfirmReservation({
        leg_id: legId,
        token,
      });
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(translateEmptyLegError(result.error));
    });
  }

  function handleRelease() {
    setError(null);
    startTransition(async () => {
      const result = await adminReleaseReservation({ leg_id: legId });
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(translateEmptyLegError(result.error));
    });
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 sm:grid-cols-2">
        <DLRow label={emptyLegsAr.reservedCustomerName}>
          {customerName ?? '—'}
        </DLRow>
        <DLRow label={emptyLegsAr.reservedCustomerPhone}>
          {customerPhone ? (
            <span dir="ltr" className="font-ar">
              {customerPhone}
            </span>
          ) : (
            '—'
          )}
        </DLRow>
        <DLRow label={emptyLegsAr.reservedExpiresAt}>
          <span dir="ltr" className="font-ar">
            {expiresAt ?? '—'}
          </span>
        </DLRow>
      </dl>

      <div className="flex flex-wrap gap-2">
        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-ar inline-flex items-center gap-2 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-200 transition-colors hover:bg-emerald-500/15"
          >
            {emptyLegsAr.reservedCallCustomer}
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => setShowConfirmInput((v) => !v)}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-1.5 text-sm text-gold-light transition-colors hover:bg-gold/15"
        >
          {emptyLegsAr.reservedConfirmReservation}
        </button>
        <button
          type="button"
          onClick={handleRelease}
          disabled={isPending}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-red-400/40 bg-red-500/10 px-4 py-1.5 text-sm text-red-200 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? emptyLegsAr.formSubmitting
            : emptyLegsAr.reservedReleaseReservation}
        </button>
      </div>

      {showConfirmInput ? (
        <form
          onSubmit={handleConfirm}
          className="rounded-lg border border-border bg-navy-secondary/40 p-3"
        >
          <p className="font-ar mb-2 text-xs text-ink-muted">
            {emptyLegsAr.reservedConfirmHint}
          </p>
          <label
            htmlFor="reservation_token"
            className="font-ar mb-1 block text-xs text-ink-muted"
          >
            {emptyLegsAr.reservedConfirmFieldToken}
          </label>
          <input
            id="reservation_token"
            name="reservation_token"
            type="text"
            required
            dir="ltr"
            className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-1.5 text-sm text-gold-light transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending
                ? emptyLegsAr.formSubmitting
                : emptyLegsAr.reservedConfirmSubmit}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="font-ar text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function DLRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-navy-card/40 p-2">
      <dt className="font-ar text-xs text-ink-muted">{label}</dt>
      <dd className="font-ar mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}
