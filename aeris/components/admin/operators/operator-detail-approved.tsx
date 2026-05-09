'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Pause, KeyRound, MessageCircle, FileText, Repeat } from 'lucide-react';
import { operatorsAr } from '@/lib/i18n/operators-ar';
import {
  adminSuspendOperator,
  adminResetOperatorPassword,
  adminMintOperatorOtp,
} from '@/app/actions/operators';
import type { OperatorRow } from '@/types/database';

type Toast =
  | { kind: 'success'; message: string; details?: string }
  // 'warning' renders a yellow banner used when the
  // password-reset action succeeded at the DB but email
  // delivery failed (Codex round 1 PR #41 P1 #1 fix).
  | { kind: 'warning'; message: string; manual_password?: string }
  | { kind: 'error'; message: string }
  | null;

function errorMessage(code?: string): string {
  if (!code) return operatorsAr.errors.unknown;
  const map = operatorsAr.errors as Record<string, string>;
  return map[code] ?? `${operatorsAr.errors.unknown} (${code})`;
}

function waUrl(phone: string, message: string): string {
  const cleaned = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

export function OperatorDetailApproved({ operator }: { operator: OperatorRow }) {
  const [isPending, startTransition] = useTransition();
  const [suspendReason, setSuspendReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [toast, setToast] = useState<Toast>(null);

  const onSuspend = () => {
    if (suspendReason.trim().length === 0) {
      setToast({ kind: 'error', message: operatorsAr.errors.reason_required });
      return;
    }
    setToast(null);
    startTransition(async () => {
      const result = await adminSuspendOperator({
        operator_id: operator.id,
        reason: suspendReason,
      });
      if (result.ok) {
        setToast({
          kind: 'success',
          message: operatorsAr.toasts.suspended,
          details: `تمّ إلغاء ${result.sessions_revoked} جلسة نشطة.`,
        });
        setSuspendReason('');
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
        // Codex round 1 PR #41 P1 #1 fix: surface degraded
        // delivery state so admin doesn't think the operator
        // received the password when they didn't.
        if (result.email_delivered) {
          setToast({
            kind: 'success',
            message: operatorsAr.toasts.passwordReset,
            details: `تمّ إلغاء ${result.sessions_revoked} جلسة.`,
          });
        } else {
          setToast({
            kind: 'warning',
            message: operatorsAr.toasts.passwordResetEmailFailed,
            manual_password: result.manual_password ?? newPassword,
          });
        }
        setNewPassword('');
      } else {
        setToast({ kind: 'error', message: errorMessage(result.error) });
      }
    });
  };

  const onMintOtp = (purpose: 'login' | 'recovery') => {
    setToast(null);
    startTransition(async () => {
      const result = await adminMintOperatorOtp({
        operator_id: operator.id,
        purpose,
      });
      if (result.ok) {
        const message = `رمز Aeris المؤقّت: ${result.plaintext_code}\nصالح لمدة 10 دقائق.`;
        const wa = result.whatsapp_phone ? waUrl(result.whatsapp_phone, message) : null;
        setToast({
          kind: 'success',
          message: operatorsAr.toasts.otpMinted,
          details: wa ? `الرمز: ${result.plaintext_code} · افتح WhatsApp: ${wa}` : `الرمز: ${result.plaintext_code}`,
        });
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
          {toast.kind === 'success' && toast.details ? (
            <p className="mt-2 break-all text-xs text-emerald-200">{toast.details}</p>
          ) : null}
          {toast.kind === 'warning' && toast.manual_password ? (
            <p
              dir="ltr"
              className="mt-3 select-all rounded-md border border-amber-500/40 bg-navy-secondary/60 px-3 py-2 text-center font-mono text-base text-amber-50"
            >
              {toast.manual_password}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Pause className="h-4 w-4 text-rose-200" aria-hidden />
            <h3 className="font-ar text-base font-medium text-rose-100">
              {operatorsAr.actions.suspend}
            </h3>
          </div>
          <label htmlFor="suspend-reason" className="font-ar mb-1 block text-xs text-rose-100/80">
            {operatorsAr.forms.suspendReasonLabel}
          </label>
          <textarea
            id="suspend-reason"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder={operatorsAr.forms.suspendReasonPlaceholder}
            rows={3}
            className="font-ar mb-3 w-full resize-none rounded-lg border border-rose-500/40 bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:border-rose-400 focus:outline-none"
            disabled={isPending}
          />
          <button
            type="button"
            onClick={onSuspend}
            disabled={isPending || suspendReason.trim().length === 0}
            className="font-ar w-full rounded-lg border border-rose-400 bg-rose-500/20 px-4 py-2.5 text-sm font-medium text-rose-50 transition-colors hover:bg-rose-500/30 disabled:opacity-60"
          >
            {operatorsAr.actions.suspend}
          </button>
        </section>

        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-200" aria-hidden />
            <h3 className="font-ar text-base font-medium text-amber-100">
              {operatorsAr.actions.resetPassword}
            </h3>
          </div>
          <label htmlFor="new-password" className="font-ar mb-1 block text-xs text-amber-100/80">
            {operatorsAr.forms.newPasswordLabel}
          </label>
          <input
            id="new-password"
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

        <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-sky-200" aria-hidden />
            <h3 className="font-ar text-base font-medium text-sky-100">
              {operatorsAr.actions.mintOtp}
            </h3>
          </div>
          <p className="font-ar mb-4 text-xs text-sky-100/80">
            {operatorsAr.forms.otpDestinationLabel}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onMintOtp('login')}
              disabled={isPending}
              className="font-ar flex-1 rounded-lg border border-sky-400 bg-sky-500/20 px-4 py-2 text-sm text-sky-50 transition-colors hover:bg-sky-500/30 disabled:opacity-60"
            >
              تسجيل دخول
            </button>
            <button
              type="button"
              onClick={() => onMintOtp('recovery')}
              disabled={isPending}
              className="font-ar flex-1 rounded-lg border border-sky-400 bg-sky-500/20 px-4 py-2 text-sm text-sky-50 transition-colors hover:bg-sky-500/30 disabled:opacity-60"
            >
              استعادة
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-navy-card/40 p-5">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gold-light" aria-hidden />
            <h3 className="font-ar text-base font-medium text-ink-primary">
              {operatorsAr.actions.setDocuments}
            </h3>
          </div>
          <p className="font-ar text-xs text-ink-muted">
            رفع وتحديث الوثائق التنظيمية (السجل التجاري، رخصة الطيران).
          </p>
          <Link
            href={`/admin/operators/${operator.id}/documents`}
            className="font-ar inline-flex items-center justify-center rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/20"
          >
            فتح صفحة الوثائق
          </Link>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-navy-card/40 p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-gold-light" aria-hidden />
            <h3 className="font-ar text-base font-medium text-ink-primary">
              {operatorsAr.actions.convertStub}
            </h3>
          </div>
          <p className="font-ar text-xs text-ink-muted">
            ربط هذا المشغّل بسجلّ Phase 7 موجود — تحوّل جميع رحلات السجلّ إلى المشغّل وتُؤرشَف.
          </p>
          <Link
            href={`/admin/empty-legs/operators?convert_target=${operator.id}`}
            className="font-ar inline-flex items-center justify-center rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold-light transition-colors hover:bg-gold/20"
          >
            اختيار سجلّ Phase 7
          </Link>
        </section>
      </div>
    </div>
  );
}
