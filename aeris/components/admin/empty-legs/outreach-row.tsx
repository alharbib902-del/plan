'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { markOutreachSent } from '@/app/actions/empty-legs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { formatDateTimeAr, formatSarAmount } from './formatters';
import { translateEmptyLegError } from './error-translator';
import type { OutreachQueueRow } from '@/lib/admin/empty-legs/queries';

export function OutreachRow({ row }: { row: OutreachQueueRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleMarkSent() {
    setError(null);
    startTransition(async () => {
      const result = await markOutreachSent({ notification_id: row.id });
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(translateEmptyLegError(result.error));
    });
  }

  return (
    <article className="rounded-xl border border-border bg-navy-card/40 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-gold-light">
            {row.leg_number ?? '—'}
          </div>
          <div className="font-ar mt-1 text-sm text-ink">
            {row.leg_route_origin ?? '—'}
            {' ← '}
            {row.leg_route_destination ?? '—'}
          </div>
        </div>
        <div className="font-ar text-sm text-ink-secondary">
          {emptyLegsAr.detailCurrentPriceLabel}:{' '}
          {formatSarAmount(row.leg_current_price)}
        </div>
      </header>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="font-ar text-xs text-ink-muted">
            {emptyLegsAr.outreachCustomerLabel}
          </dt>
          <dd className="font-ar mt-1 text-sm text-ink">
            {row.lead_customer_name ?? '—'}
            {row.lead_customer_phone ? (
              <span dir="ltr" className="font-ar mr-2 text-xs text-ink-muted">
                {row.lead_customer_phone}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="font-ar text-xs text-ink-muted">
            {emptyLegsAr.colCreated}
          </dt>
          <dd className="font-ar mt-1 text-sm text-ink-secondary">
            {formatDateTimeAr(row.sent_at)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        {row.wa_url ? (
          <a
            href={row.wa_url}
            target="_blank"
            rel="noreferrer noopener"
            className="font-ar inline-flex items-center gap-2 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-200 transition-colors hover:bg-emerald-500/15"
          >
            {emptyLegsAr.outreachWaUrl}
          </a>
        ) : (
          <span className="font-ar text-xs text-ink-muted">—</span>
        )}
        <button
          type="button"
          onClick={handleMarkSent}
          disabled={isPending}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-1.5 text-sm text-gold-light transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? emptyLegsAr.outreachSendingButton
            : emptyLegsAr.outreachMarkSent}
        </button>
      </div>
      {error ? (
        <p className="font-ar mt-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
