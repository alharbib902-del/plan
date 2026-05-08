'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminUpdatePrice } from '@/app/actions/empty-legs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { translateEmptyLegError } from './error-translator';

export function PriceEditForm({
  legId,
  currentPrice,
  floorPrice,
  originalPrice,
}: {
  legId: string;
  currentPrice: number | null;
  floorPrice: number | null;
  originalPrice: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const form = new FormData(e.currentTarget);
    const raw = form.get('new_price');
    const value = typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setError(translateEmptyLegError('new_price_invalid'));
      return;
    }

    startTransition(async () => {
      const result = await adminUpdatePrice({
        leg_id: legId,
        new_price: value,
      });
      if (result.ok) {
        setSuccess(result.current_price);
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
        {emptyLegsAr.priceEditFormTitle}
      </h3>
      <p className="font-ar mb-3 text-xs text-ink-muted">
        {emptyLegsAr.priceEditFormHint}
      </p>
      <div className="font-ar mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {currentPrice !== null ? (
          <span>
            {emptyLegsAr.detailCurrentPriceLabel}: {currentPrice}
          </span>
        ) : null}
        {floorPrice !== null ? <span>· Floor: {floorPrice}</span> : null}
        {originalPrice !== null ? (
          <span>
            · {emptyLegsAr.detailOriginalPriceLabel}: {originalPrice}
          </span>
        ) : null}
      </div>
      <label
        htmlFor="new_price"
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {emptyLegsAr.priceEditFieldNewPrice}
      </label>
      <input
        id="new_price"
        name="new_price"
        type="number"
        min={1}
        step="0.01"
        required
        className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
      />
      {error ? (
        <p className="font-ar mt-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {success !== null ? (
        <p className="font-ar mt-2 text-xs text-emerald-200" role="status">
          {emptyLegsAr.detailCurrentPriceLabel}: {success}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-1.5 text-sm text-gold-light transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? emptyLegsAr.formSubmitting
            : emptyLegsAr.priceEditSubmit}
        </button>
      </div>
    </form>
  );
}
