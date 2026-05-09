'use client';

import { useState, useTransition } from 'react';
import { Play, KeyRound } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import {
  adminUnsuspendOperator,
  adminResetOperatorPassword,
} from '@/app/actions/operators';
import type { OperatorRow } from '@/types/database';

type Toast =
  | { kind: 'success'; message: string; details?: string }
  | { kind: 'error'; message: string }
  | null;

function errorMessage(code?: string): string {
  if (!code) return operatorsAr.errors.unknown;
  const map = operatorsAr.errors as Record<string, string>;
  return map[code] ?? `${operatorsAr.errors.unknown} (${code})`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function OperatorDetailSuspended({ operator }: { operator: OperatorRow }) {
  const [isPending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState('');
  const [toast, setToast] = useState<Toast>(null);

  const onUnsuspend = () => {
    setToast(null);
    startTransition(async () => {
      const result = await adminUnsuspendOperator({ operator_id: operator.id });
      if (result.ok) {
        setToast({ kind: 'success', message: operatorsAr.toasts.unsuspended });
      } else {
        setToast({ kind: 'error', message: errorMessage(result.error) });
      }
    });
  };

  const onResetPassword = () => {
    if (newPassword.length < 10) {
      setToast({
        kind: 'error',
        message: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل',
      });
      return;
    }
    setToast(null);
    startTransition(async () => {
      const result = await adminResetOperatorPassword({
        operator_id: operator.id,
        new_password: newPassword,
      });
      if (result.ok) {
        setToast({
          kind: 'success',
          message: operatorsAr.toasts.passwordReset,
          details: `تمّ إلغاء ${result.sessions_revoked} جلسة وإرسال البريد للمشغّل.`,
        });
        setNewPassword('');
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
              : 'border-rose-500/40 bg-rose-500/10 text-rose-100'
          }`}
        >
          <p>{toast.message}</p>
          {toast.kind === 'success' && toast.details ? (
            <p className="mt-2 text-xs text-emerald-200">{toast.details}</p>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
        <h3 className="font-ar mb-2 text-base font-medium text-rose-100">
          سبب الإيقاف
        </h3>
        <p className="font-ar mb-1 text-sm text-rose-100/90">
          {operator.suspension_reason ?? '—'}
        </p>
        <p className="font-ar text-xs text-rose-100/70">
          {operatorsAr.fields.suspended_at}: {formatDate(operator.suspended_at)}
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Play className="h-4 w-4 text-emerald-200" aria-hidden />
            <h3 className="font-ar text-base font-medium text-emerald-100">
              {operatorsAr.actions.unsuspend}
            </h3>
          </div>
          <p className="font-ar mb-4 text-xs text-emerald-100/80">
            ستُعاد الحالة إلى &quot;مفعّل&quot; وسيحتاج المشغّل لتسجيل الدخول مجدداً (الجلسات لم تُسترجَع).
          </p>
          <button
            type="button"
            onClick={onUnsuspend}
            disabled={isPending}
            className="font-ar w-full rounded-lg border border-emerald-400 bg-emerald-500/20 px-4 py-2.5 text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-500/30 disabled:opacity-60"
          >
            {operatorsAr.actions.unsuspend}
          </button>
        </section>

        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-200" aria-hidden />
            <h3 className="font-ar text-base font-medium text-amber-100">
              {operatorsAr.actions.resetPassword}
            </h3>
          </div>
          <input
            type="text"
            dir="ltr"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={operatorsAr.forms.newPasswordPlaceholder}
            className="mb-3 w-full rounded-lg border border-amber-500/40 bg-navy-secondary/60 px-3 py-2 font-mono text-sm text-ink-primary placeholder:text-ink-muted focus:border-amber-400 focus:outline-none"
            disabled={isPending}
          />
          <button
            type="button"
            onClick={onResetPassword}
            disabled={isPending || newPassword.length < 10}
            className="font-ar w-full rounded-lg border border-amber-400 bg-amber-500/20 px-4 py-2.5 text-sm font-medium text-amber-50 transition-colors hover:bg-amber-500/30 disabled:opacity-60"
          >
            {operatorsAr.actions.resetPassword}
          </button>
        </section>
      </div>
    </div>
  );
}
