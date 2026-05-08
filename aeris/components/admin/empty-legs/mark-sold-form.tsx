'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminMarkSoldManual } from '@/app/actions/empty-legs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { translateEmptyLegError } from './error-translator';

export function MarkSoldManualForm({ legId }: { legId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = new FormData(e.currentTarget);
    const customerName = String(form.get('customer_name') ?? '').trim();
    const customerPhone = String(form.get('customer_phone') ?? '').trim();
    if (!customerName || !customerPhone) {
      setError(translateEmptyLegError('validation_failed'));
      return;
    }

    startTransition(async () => {
      const result = await adminMarkSoldManual({
        leg_id: legId,
        customer_name: customerName,
        customer_phone: customerPhone,
      });
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
        {emptyLegsAr.markSoldFormTitle}
      </h3>
      <p className="font-ar mb-3 text-xs text-ink-muted">
        {emptyLegsAr.markSoldFormHint}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label
            htmlFor="customer_name"
            className="font-ar mb-1 block text-xs text-ink-muted"
          >
            {emptyLegsAr.markSoldFieldCustomerName}
          </label>
          <input
            id="customer_name"
            name="customer_name"
            type="text"
            required
            className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="customer_phone"
            className="font-ar mb-1 block text-xs text-ink-muted"
          >
            {emptyLegsAr.markSoldFieldCustomerPhone}
          </label>
          <input
            id="customer_phone"
            name="customer_phone"
            type="tel"
            dir="ltr"
            required
            className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
          />
        </div>
      </div>
      {error ? (
        <p className="font-ar mt-2 text-xs text-red-300" role="alert">
          {error}
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
            : emptyLegsAr.markSoldSubmit}
        </button>
      </div>
    </form>
  );
}
