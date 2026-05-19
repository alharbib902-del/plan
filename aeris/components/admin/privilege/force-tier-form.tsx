'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { forceTierChangeAction } from '@/app/actions/privilege-admin';
import { privilegeAr } from '@/lib/i18n/privilege-ar';
import type { ClientPrivilegeTier } from '@/lib/privilege/types';

const TIERS: ClientPrivilegeTier[] = ['silver', 'gold', 'platinum', 'diamond'];

export function ForceTierForm({
  clientId,
  currentTier,
}: {
  clientId: string;
  currentTier: ClientPrivilegeTier;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newTier, setNewTier] = useState<ClientPrivilegeTier>(currentTier);
  const [reason, setReason] = useState('');
  const [lockUntil, setLockUntil] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    setSuccessMessage(null);

    startTransition(async () => {
      const res = await forceTierChangeAction({
        client_id: clientId,
        new_tier: newTier,
        reason: reason.trim(),
        lock_until: lockUntil.trim() === '' ? null : lockUntil.trim(),
      });

      if (!res.ok) {
        setServerError(res.error);
        return;
      }

      const inner = res.result;
      if (inner.ok === false) {
        const errMap: Record<string, string> = {
          admin_session_metadata_required: privilegeAr.errorSessionInvalid,
          admin_reason_too_short: privilegeAr.errorReasonTooShort,
          lock_until_must_be_future: privilegeAr.errorLockUntilPast,
          client_not_found: privilegeAr.errorClientNotFound,
        };
        setServerError(errMap[inner.error] ?? inner.error);
        return;
      }

      if (inner.no_op) {
        setSuccessMessage(privilegeAr.forceNoOp);
      } else {
        setSuccessMessage(privilegeAr.forceSuccess);
      }

      // Refresh detail page on success after a short delay so user sees
      // the success state, then redirect back.
      setTimeout(() => {
        router.push(`/admin/clients/${clientId}/privilege`);
        router.refresh();
      }, 1200);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-2">
        <label className="font-ar block text-sm text-ink-primary">
          {privilegeAr.fieldNewTier} *
        </label>
        <select
          value={newTier}
          onChange={(e) => setNewTier(e.target.value as ClientPrivilegeTier)}
          required
          className="font-ar w-full rounded-lg border border-navy-card bg-navy-card/30 px-4 py-2.5 text-ink-primary"
          disabled={isPending}
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {privilegeAr.tier[t]}
              {t === currentTier ? ` — (الحالي)` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="font-ar block text-sm text-ink-primary">
          {privilegeAr.fieldReason} *
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={10}
          maxLength={500}
          rows={4}
          className="font-ar w-full rounded-lg border border-navy-card bg-navy-card/30 px-4 py-2.5 text-ink-primary"
          disabled={isPending}
        />
        <p className="font-ar text-xs text-ink-secondary">
          {reason.trim().length}/500
        </p>
      </div>

      <div className="space-y-2">
        <label className="font-ar block text-sm text-ink-primary">
          {privilegeAr.fieldLockUntil}
        </label>
        <input
          type="date"
          value={lockUntil}
          onChange={(e) => setLockUntil(e.target.value)}
          className="font-ar w-full rounded-lg border border-navy-card bg-navy-card/30 px-4 py-2.5 text-ink-primary"
          disabled={isPending}
        />
        <p className="font-ar text-xs text-ink-secondary">
          {privilegeAr.fieldLockUntilHelper}
        </p>
      </div>

      {serverError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <p className="font-ar text-sm text-rose-300">{serverError}</p>
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="font-ar text-sm text-emerald-300">{successMessage}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending || reason.trim().length < 10}
          className="font-ar flex-1 rounded-full bg-gold px-5 py-3 text-sm text-navy hover:bg-gold-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? privilegeAr.submitting : privilegeAr.submitForce}
        </button>
      </div>
    </form>
  );
}
