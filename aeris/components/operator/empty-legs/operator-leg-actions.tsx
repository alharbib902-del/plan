'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  operatorCancel,
  operatorUpdatePrice,
} from '@/app/actions/operator-empty-legs';
import {
  operatorCancelLegSession,
  operatorUpdatePriceSession,
} from '@/app/actions/operators-empty-legs-authed';
import { translateEmptyLegError } from '@/components/admin/empty-legs/error-translator';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

/**
 * Phase 8 PR 2c.1: dual-mode leg actions.
 *   - mode='token'   — Phase 7 token-bound actions
 *                      (operatorUpdatePrice / operatorCancel)
 *   - mode='session' — Phase 8 session-bound actions
 *                      (operatorUpdatePriceSession / operatorCancelLegSession)
 *
 * Field shapes are identical; only the action call differs.
 */
type AuthBinding =
  | { mode: 'token'; token: string }
  | { mode: 'session' };

type Props = AuthBinding & {
  legId: string;
  currentPrice: number | null;
  floorPrice: number | null;
  originalPrice: number | null;
};

export function OperatorLegActions(props: Props) {
  const { legId, currentPrice, floorPrice, originalPrice } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceSuccess, setPriceSuccess] = useState<number | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  function onPriceSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPriceError(null);
    setPriceSuccess(null);

    const form = new FormData(e.currentTarget);
    const raw = form.get('new_price');
    const value = typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      setPriceError(translateEmptyLegError('new_price_invalid'));
      return;
    }

    startTransition(async () => {
      const result =
        props.mode === 'token'
          ? await operatorUpdatePrice(props.token, {
              leg_id: legId,
              new_price: value,
            })
          : await operatorUpdatePriceSession({
              leg_id: legId,
              new_price: value,
            });
      if (result.ok) {
        setPriceSuccess(result.current_price);
        router.refresh();
        return;
      }
      setPriceError(translateEmptyLegError(result.error));
    });
  }

  function onCancelSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCancelError(null);

    const form = new FormData(e.currentTarget);
    const reasonRaw = form.get('reason');
    const reason =
      typeof reasonRaw === 'string' && reasonRaw.trim().length > 0
        ? reasonRaw.trim()
        : null;

    startTransition(async () => {
      const result =
        props.mode === 'token'
          ? await operatorCancel(props.token, { leg_id: legId, reason })
          : await operatorCancelLegSession({ leg_id: legId, reason });
      if (result.ok) {
        router.refresh();
        return;
      }
      setCancelError(translateEmptyLegError(result.error));
    });
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={onPriceSubmit}
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
        {priceError ? (
          <p className="font-ar mt-2 text-xs text-red-300" role="alert">
            {priceError}
          </p>
        ) : null}
        {priceSuccess !== null ? (
          <p
            className="font-ar mt-2 text-xs text-emerald-200"
            role="status"
          >
            {emptyLegsAr.detailCurrentPriceLabel}: {priceSuccess}
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

      <form
        onSubmit={onCancelSubmit}
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
        {cancelError ? (
          <p className="font-ar mt-2 text-xs text-red-300" role="alert">
            {cancelError}
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
    </div>
  );
}
