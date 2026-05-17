'use client';

import { useState, useTransition } from 'react';

import { adminActivateSubscription } from '@/app/actions/medevac-admin';

const ERROR_COPY: Record<string, string> = {
  flag_disabled: 'الخدمة غير مفعلة',
  validation_failed: 'البيانات غير صحيحة',
  server_error: 'خطأ في الخادم',
  subscription_not_found: 'الاشتراك غير موجود',
  subscription_not_activatable: 'الاشتراك في حالة لا تسمح بالتفعيل',
};

export function ActivateSubscriptionButton({
  subscriptionId,
}: {
  subscriptionId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'ok'; startDate?: string; endDate?: string }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending || status.kind === 'ok'}
        onClick={() => {
          if (!confirm('تفعيل هذا الاشتراك بعد تأكيد الدفع. متابعة؟')) return;
          setStatus({ kind: 'idle' });
          startTransition(async () => {
            const r = await adminActivateSubscription({
              subscription_id: subscriptionId,
            });
            if (r.ok) {
              setStatus({
                kind: 'ok',
                startDate: r.start_date,
                endDate: r.end_date,
              });
            } else {
              setStatus({
                kind: 'err',
                message: ERROR_COPY[r.error] ?? 'خطأ',
              });
            }
          });
        }}
        className="font-ar rounded-xl bg-emerald-500 px-6 py-3 text-base text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending
          ? 'جاري التفعيل…'
          : status.kind === 'ok'
            ? 'تم التفعيل ✓'
            : 'تفعيل الاشتراك'}
      </button>
      {status.kind === 'ok' && (
        <p className="font-ar text-sm text-emerald-300">
          الاشتراك نشط الآن. البدء:{' '}
          <span dir="ltr">{status.startDate ?? '—'}</span> · الانتهاء:{' '}
          <span dir="ltr">{status.endDate ?? '—'}</span>
        </p>
      )}
      {status.kind === 'err' && (
        <p className="font-ar text-sm text-rose-300">{status.message}</p>
      )}
    </div>
  );
}
