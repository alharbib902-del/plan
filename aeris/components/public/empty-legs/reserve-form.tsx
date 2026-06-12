'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { reserveEmptyLeg } from '@/app/actions/empty-legs-public';
import { translateEmptyLegError } from '@/components/admin/empty-legs/error-translator';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';

interface PublicReserveFormProps {
  legNumber: string;
  /** When the visitor is a logged-in client, the page pre-fills these
   *  from the validated session so the client doesn't retype details.
   *  The guest reserve action is still used — this is auto-fill only,
   *  not account-linking (that stays the /me authenticated flow). */
  prefillName?: string;
  prefillPhone?: string;
  isLoggedIn?: boolean;
  /** 2026-06 request-to-book — client pricing is hidden, so the form
   *  reads as "send a reservation request" instead of "confirm a
   *  booking". Passed from the server page (env flags are server-only). */
  requestMode?: boolean;
}

export function PublicReserveForm({
  legNumber,
  prefillName,
  prefillPhone,
  isLoggedIn,
  requestMode,
}: PublicReserveFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    const customerName = String(form.get('customer_name') ?? '').trim();
    const customerPhone = String(form.get('customer_phone') ?? '').trim();
    const optInRaw = form.get('opt_in');
    const optIn = optInRaw === 'on' || optInRaw === 'true';

    startTransition(async () => {
      const result = await reserveEmptyLeg({
        leg_number: legNumber,
        customer_name: customerName,
        customer_phone: customerPhone,
        opt_in: optIn,
      });
      if (result.ok) {
        // Pass the raw token through the URL so the
        // post-reservation page can render the
        // countdown + cancel button. Token is
        // single-use; the DB stored only the hash.
        const params = new URLSearchParams({
          token: result.reservation_token,
        });
        router.push(
          `/empty-legs/${result.leg_number}/reserved?${params.toString()}`
        );
        return;
      }
      setError(translateEmptyLegError(result.error));
      setFieldErrors(result.field_errors ?? {});
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="font-ar text-sm text-ink-muted">
        {requestMode
          ? emptyLegsAr.pricingHiddenReserveHint
          : emptyLegsAr.publicReserveHint}
      </p>

      {isLoggedIn ? (
        <p className="font-ar text-xs text-gold-light/80">
          {emptyLegsAr.publicReservePrefilledHint}
        </p>
      ) : (
        <p className="font-ar text-xs text-ink-muted">
          {emptyLegsAr.publicReserveNudgePrefix}{' '}
          <Link
            href="/login"
            className="text-gold-light underline transition-colors hover:text-gold"
          >
            {emptyLegsAr.publicReserveNudgeCta}
          </Link>{' '}
          {emptyLegsAr.publicReserveNudgeSuffix}
        </p>
      )}

      <div>
        <label
          htmlFor="customer_name"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {emptyLegsAr.publicReserveFieldName}{' '}
          <span className="text-red-300">*</span>
        </label>
        <input
          id="customer_name"
          name="customer_name"
          type="text"
          required
          defaultValue={prefillName ?? ''}
          className={inputCls}
        />
        {fieldErrors.customer_name ? (
          <p className="font-ar mt-1 text-xs text-red-300" role="alert">
            {translateEmptyLegError(fieldErrors.customer_name)}
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="customer_phone"
          className="font-ar mb-1 block text-xs text-ink-muted"
        >
          {emptyLegsAr.publicReserveFieldPhone}{' '}
          <span className="text-red-300">*</span>
        </label>
        <input
          id="customer_phone"
          name="customer_phone"
          type="tel"
          dir="ltr"
          required
          defaultValue={prefillPhone ?? ''}
          className={inputCls}
        />
        {fieldErrors.customer_phone ? (
          <p className="font-ar mt-1 text-xs text-red-300" role="alert">
            {translateEmptyLegError(fieldErrors.customer_phone)}
          </p>
        ) : null}
      </div>

      {/*
        Codex iteration-1 P1 #1 fix: opt-in checkbox defaults
        UNCHECKED. The Server Action only sets
        `lead_inquiries.empty_legs_opt_in = TRUE` when
        ticked. An unticked submission keeps the column at
        FALSE per the schema default.
      */}
      <label className="flex items-start gap-3 rounded-lg border border-border bg-navy-secondary/40 p-3">
        <input type="checkbox" name="opt_in" className="mt-1" />
        <span>
          <span className="font-ar block text-sm text-ink">
            {emptyLegsAr.publicReserveOptInLabel}
          </span>
          <span className="font-ar mt-1 block text-xs text-ink-muted">
            {emptyLegsAr.publicReserveOptInHint}
          </span>
        </span>
      </label>

      {error ? (
        <div
          role="alert"
          className="font-ar rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/15 px-6 py-3 text-base text-gold-light transition-colors hover:bg-gold/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? emptyLegsAr.formSubmitting
            : requestMode
              ? emptyLegsAr.pricingHiddenSubmit
              : emptyLegsAr.publicReserveSubmit}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-base text-ink shadow-sm focus:border-gold/60 focus:outline-none';
