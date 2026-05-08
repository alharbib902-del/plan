'use client';

import { useState, useTransition } from 'react';

import { adminMintOperatorSession } from '@/app/actions/phase7-operator-stubs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { translateEmptyLegError } from './error-translator';
import { formatDateTimeAr } from './formatters';
import type { Phase7OperatorStubRow } from '@/lib/empty-legs/types';

interface MintedSession {
  raw_token: string;
  portal_url: string;
  expires_at: string;
  operator_stub_id: string;
}

export function SessionMintForm({
  stubs,
  siteUrl,
}: {
  stubs: Phase7OperatorStubRow[];
  siteUrl: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedSession | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMinted(null);

    const form = new FormData(e.currentTarget);
    const stubId = String(form.get('operator_stub_id') ?? '');
    if (!stubId) {
      setError(translateEmptyLegError('operator_stub_id_invalid'));
      return;
    }

    startTransition(async () => {
      const result = await adminMintOperatorSession({
        operator_stub_id: stubId,
      });
      if (result.ok) {
        setMinted({
          raw_token: result.raw_token,
          portal_url: result.portal_url,
          expires_at: result.expires_at,
          operator_stub_id: result.operator_stub_id,
        });
        return;
      }
      setError(translateEmptyLegError(result.error));
    });
  }

  if (stubs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-6 text-center">
        <p className="font-ar text-sm text-ink-muted">
          {emptyLegsAr.adminSessionsNoStubs}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label
            htmlFor="operator_stub_id"
            className="font-ar mb-1 block text-xs text-ink-muted"
          >
            {emptyLegsAr.adminSessionsFieldStub}
          </label>
          <select
            id="operator_stub_id"
            name="operator_stub_id"
            required
            defaultValue=""
            className="font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
          >
            <option value="" disabled>
              —
            </option>
            {stubs.map((stub) => (
              <option key={stub.id} value={stub.id}>
                {stub.company_name}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <p className="font-ar text-xs text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isPending}
            className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-4 py-1.5 text-sm text-gold-light transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending
              ? emptyLegsAr.formSubmitting
              : emptyLegsAr.adminSessionsSubmit}
          </button>
        </div>
      </form>

      {minted ? (
        <article className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 p-4">
          <h3 className="font-ar text-sm text-emerald-200">
            {emptyLegsAr.adminSessionsTokenIssuedTitle}
          </h3>
          <p className="font-ar mt-1 text-xs text-emerald-200/80">
            {emptyLegsAr.adminSessionsTokenIssuedHint}
          </p>
          <div className="mt-3 space-y-2">
            <div>
              <div className="font-ar text-xs text-ink-muted">
                {emptyLegsAr.adminSessionsTokenUrlLabel}
              </div>
              <div
                dir="ltr"
                className="mt-1 break-all rounded-md border border-emerald-400/30 bg-navy-card/40 p-2 font-mono text-xs text-emerald-100"
              >
                {`${siteUrl}${minted.portal_url}`}
              </div>
            </div>
            <div className="font-ar text-xs text-emerald-200/80">
              {emptyLegsAr.adminSessionsTokenExpires}:{' '}
              {formatDateTimeAr(minted.expires_at)}
            </div>
          </div>
        </article>
      ) : null}
    </div>
  );
}
