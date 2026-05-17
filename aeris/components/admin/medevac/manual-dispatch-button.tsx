'use client';

import { useState, useTransition } from 'react';

import { adminManualDispatchMedevacRequest } from '@/app/actions/medevac-admin';

const ERROR_COPY: Record<string, string> = {
  flag_disabled: 'الخدمة غير مفعلة',
  request_id_invalid: 'معرّف الطلب غير صحيح',
  medevac_request_not_found: 'الطلب غير موجود',
  event_type_invalid: 'نوع الحدث غير صحيح',
  server_error: 'خطأ في الخادم',
};

export function ManualDispatchButton({
  requestId,
}: {
  requestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'ok' } | { kind: 'err'; message: string }
  >({ kind: 'idle' });

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !confirm(
              'إعادة توزيع هذا الطلب على المشغلين المعتمدين؟ سيتم إنشاء حدث dispatch جديد في الـ outbox.'
            )
          )
            return;
          setStatus({ kind: 'idle' });
          startTransition(async () => {
            const r = await adminManualDispatchMedevacRequest({
              request_id: requestId,
            });
            if (r.ok) setStatus({ kind: 'ok' });
            else
              setStatus({
                kind: 'err',
                message: ERROR_COPY[r.error] ?? r.error,
              });
          });
        }}
        className="font-ar rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
      >
        {pending ? 'جاري الإرسال…' : 'إعادة توزيع يدوي'}
      </button>
      {status.kind === 'ok' && (
        <p className="font-ar text-xs text-emerald-300">
          تم إنشاء حدث dispatch ✓ — التوزيع الفعلي يحدث خلال ≤ 5 دقائق
          (cron dispatch-drain).
        </p>
      )}
      {status.kind === 'err' && (
        <p className="font-ar text-xs text-rose-300">{status.message}</p>
      )}
    </div>
  );
}
