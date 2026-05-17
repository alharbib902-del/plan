'use client';

import { useState, useTransition } from 'react';

import { adminUpsertShieldConfig } from '@/app/actions/medevac-admin';

interface OperatorOption {
  id: string;
  label: string;
}

interface Props {
  operators: OperatorOption[];
  currentOperatorId: string | null;
  currentFounderEmail: string | null;
}

const ERROR_COPY: Record<string, string> = {
  flag_disabled: 'الخدمة غير مفعلة',
  default_operator_id_invalid: 'معرّف المشغل غير صحيح',
  founder_email_invalid: 'البريد الإلكتروني غير صحيح',
  default_operator_not_found: 'المشغل المختار غير موجود',
  server_error: 'خطأ في الخادم',
};

export function ShieldConfigForm({
  operators,
  currentOperatorId,
  currentFounderEmail,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'ok' }
    | { kind: 'err'; message: string }
  >({ kind: 'idle' });
  const [operatorId, setOperatorId] = useState(currentOperatorId ?? '');
  const [email, setEmail] = useState(currentFounderEmail ?? '');

  function onSave() {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const r = await adminUpsertShieldConfig({
        default_operator_id: operatorId || null,
        founder_notification_email: email || null,
      });
      if (r.ok) setStatus({ kind: 'ok' });
      else setStatus({ kind: 'err', message: ERROR_COPY[r.error] ?? r.error });
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="font-ar mb-2 block text-sm text-ink-secondary">
          المشغل الافتراضي لـ Aeris Shield
        </label>
        <select
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
        >
          <option value="">— لا يوجد —</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="font-ar mt-1 text-xs text-ink-muted">
          هذا المشغل يستلم جميع أحداث Shield المُغطَّاة. يجب أن يكون
          معتمداً (signup_status=approved) ولديه طائرات معتمدة طبياً.
        </p>
      </div>

      <div>
        <label className="font-ar mb-2 block text-sm text-ink-secondary">
          البريد الإلكتروني لإشعارات المؤسس
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
          maxLength={120}
          className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="font-ar rounded-xl bg-gold px-6 py-3 text-base font-medium text-navy hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'جاري الحفظ…' : 'حفظ'}
        </button>
        {status.kind === 'ok' && (
          <span className="font-ar text-sm text-emerald-300">
            تم الحفظ ✓
          </span>
        )}
        {status.kind === 'err' && (
          <span className="font-ar text-sm text-rose-300">
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
