'use client';

import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import {
  adminApproveOperator,
  adminRejectOperator,
} from '@/app/actions/operators';
import type { OperatorRow } from '@/types/database';

type Toast =
  | { kind: 'success'; message: string; welcomeUrl?: string }
  // 'warning' renders an amber banner when approve succeeded
  // at the DB but welcome-email delivery failed (Codex round 2
  // PR #41 P2 #2 fix). The welcome URL is always shown so admin
  // can relay it manually.
  | { kind: 'warning'; message: string; welcomeUrl: string }
  | { kind: 'error'; message: string }
  | null;

function errorMessage(code?: string): string {
  if (!code) return operatorsAr.errors.unknown;
  const map = operatorsAr.errors as Record<string, string>;
  return map[code] ?? `${operatorsAr.errors.unknown} (${code})`;
}

export function OperatorDetailPending({ operator }: { operator: OperatorRow }) {
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<Toast>(null);

  const onApprove = () => {
    setToast(null);
    startTransition(async () => {
      const result = await adminApproveOperator({ operator_id: operator.id });
      if (result.ok) {
        // Codex round 2 PR #41 P2 #2 fix: surface degraded
        // delivery state when welcome email fails (operator
        // would otherwise have no way to reach the magic link).
        if (result.email_delivered) {
          setToast({
            kind: 'success',
            message: operatorsAr.toasts.approved,
            welcomeUrl: result.welcome_url,
          });
        } else {
          setToast({
            kind: 'warning',
            message: operatorsAr.toasts.approvedEmailFailed,
            welcomeUrl: result.welcome_url,
          });
        }
      } else {
        setToast({ kind: 'error', message: errorMessage(result.error) });
      }
    });
  };

  const onReject = () => {
    if (reason.trim().length === 0) {
      setToast({ kind: 'error', message: operatorsAr.errors.reason_required });
      return;
    }
    setToast(null);
    startTransition(async () => {
      const result = await adminRejectOperator({
        operator_id: operator.id,
        reason,
      });
      if (result.ok) {
        setToast({ kind: 'success', message: operatorsAr.toasts.rejected });
        setReason('');
      } else {
        setToast({ kind: 'error', message: errorMessage(result.error) });
      }
    });
  };

  return (
    <div className="space-y-6">
      {toast ? (
        <div
          className={`font-ar rounded-xl border px-4 py-3 text-sm ${
            toast.kind === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
              : toast.kind === 'warning'
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          <p>{toast.message}</p>
          {toast.kind === 'success' && toast.welcomeUrl ? (
            <p className="mt-2 break-all font-mono text-xs text-emerald-200">
              {toast.welcomeUrl}
            </p>
          ) : null}
          {toast.kind === 'warning' && toast.welcomeUrl ? (
            <p
              dir="ltr"
              className="mt-3 select-all break-all rounded-md border border-amber-500/40 bg-navy-secondary/60 px-3 py-2 font-mono text-xs text-amber-50"
            >
              {toast.welcomeUrl}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <h3 className="font-ar mb-2 text-base font-medium text-emerald-100">
            {operatorsAr.actions.approve}
          </h3>
          <p className="font-ar mb-4 text-sm text-emerald-100/80">
            بعد القبول سيُرسَل بريد ترحيب يحتوي رابط تفعيل صالحاً لمدة 7 أيام.
          </p>
          <button
            type="button"
            onClick={onApprove}
            disabled={isPending}
            className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400 bg-emerald-500/20 px-4 py-2.5 text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-500/30 disabled:opacity-60"
          >
            <Check className="h-4 w-4" aria-hidden />
            {operatorsAr.actions.approve}
          </button>
        </section>

        <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
          <h3 className="font-ar mb-2 text-base font-medium text-rose-100">
            {operatorsAr.actions.reject}
          </h3>
          <label
            htmlFor="reject-reason"
            className="font-ar mb-1 block text-xs text-rose-100/80"
          >
            {operatorsAr.forms.rejectReasonLabel}
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={operatorsAr.forms.rejectReasonPlaceholder}
            rows={3}
            className="font-ar mb-3 w-full resize-none rounded-lg border border-rose-500/40 bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:border-rose-400 focus:outline-none"
            disabled={isPending}
          />
          <button
            type="button"
            onClick={onReject}
            disabled={isPending || reason.trim().length === 0}
            className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-400 bg-rose-500/20 px-4 py-2.5 text-sm font-medium text-rose-50 transition-colors hover:bg-rose-500/30 disabled:opacity-60"
          >
            <X className="h-4 w-4" aria-hidden />
            {operatorsAr.actions.reject}
          </button>
        </section>
      </div>
    </div>
  );
}
