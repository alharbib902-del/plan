'use client';

import { useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';
import { submitOperatorOffer } from '@/app/operator/offer/[token]/actions';
import {
  AIRCRAFT_CATEGORIES,
  AIRCRAFT_CATEGORY_LABEL_AR,
  type AircraftCategoryValue,
} from '@/lib/validators/promote-lead';
import { cn } from '@/lib/utils/cn';

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export function OperatorOfferForm({ token }: { token: string }) {
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  const [, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind === 'submitting') return;
    setState({ kind: 'submitting' });

    const formData = new FormData(event.currentTarget);
    formData.append('token', token);

    startTransition(async () => {
      const result = await submitOperatorOffer(formData);
      if (result.ok) {
        setState({ kind: 'success' });
        return;
      }
      setState({ kind: 'error', message: translateError(result.error) });
    });
  };

  if (state.kind === 'success') {
    return <SuccessPanel />;
  }

  const submitting = state.kind === 'submitting';

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-border bg-navy-card/40 p-6"
    >
      <div>
        <h3 className="font-ar text-lg text-ink">تقديم عرض</h3>
        <p className="font-ar mt-1 text-xs text-ink-muted">
          املأ بيانات العرض. سيتواصل معك المؤسس عبر واتساب لتأكيد القبول.
        </p>
      </div>

      <Field label="اسم الشركة المشغّلة" required>
        <input
          type="text"
          name="operator_name"
          required
          maxLength={120}
          className={inputClass()}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="رقم واتساب المشغّل (E.164)" required>
          <input
            type="tel"
            name="operator_phone"
            required
            placeholder="+966500000000"
            dir="ltr"
            className={inputClass()}
          />
        </Field>
        <Field label="بريد إلكتروني (اختياري)">
          <input
            type="email"
            name="operator_email"
            dir="ltr"
            className={inputClass()}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="فئة الطائرة">
          <select
            name="aircraft_category"
            defaultValue=""
            className={inputClass()}
          >
            <option value="" className="bg-navy">
              — اختر —
            </option>
            {AIRCRAFT_CATEGORIES.map((cat) => (
              <option
                key={cat}
                value={cat as AircraftCategoryValue}
                className="bg-navy"
              >
                {AIRCRAFT_CATEGORY_LABEL_AR[cat]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="نوع الطائرة">
          <input
            type="text"
            name="aircraft_type"
            placeholder="Gulfstream G650"
            maxLength={80}
            className={inputClass()}
          />
        </Field>
      </div>

      <Field label="رقم تسجيل الطائرة (اختياري)">
        <input
          type="text"
          name="aircraft_registration"
          dir="ltr"
          maxLength={20}
          placeholder="HZ-XYZ"
          className={inputClass()}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="السعر الإجمالي (ريال سعودي)" required>
          <input
            type="number"
            name="total_price_sar"
            required
            min={1000}
            step="any"
            className={inputClass()}
          />
        </Field>
        <Field label="موعد الإقلاع المقترح" required>
          <input
            type="datetime-local"
            name="departure_eta"
            required
            className={inputClass()}
          />
        </Field>
      </div>

      <Field label="مدة صلاحية العرض (ساعات)" required>
        <input
          type="number"
          name="validity_hours"
          required
          min={1}
          max={168}
          defaultValue={24}
          className={inputClass()}
        />
      </Field>

      <Field label="ملاحظات (اختياري)">
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          className={inputClass()}
        />
      </Field>

      <button
        type="submit"
        disabled={submitting}
        className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-md border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Send className="h-4 w-4" aria-hidden />
        )}
        إرسال العرض
      </button>

      {state.kind === 'error' && (
        <p
          className="font-ar rounded-md border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200"
          role="alert"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
        {required ? <span className="ms-1 text-red-300">*</span> : null}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function inputClass() {
  return cn(
    'font-ar block w-full rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink',
    'placeholder:text-ink-muted hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40'
  );
}

function SuccessPanel() {
  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-8 text-center">
      <h3 className="font-ar text-xl text-emerald-200">تم استلام عرضك</h3>
      <p className="font-ar mt-3 text-sm leading-7 text-emerald-100/80">
        سيتواصل معك المؤسس عبر واتساب لتأكيد القبول. شكرًا لتعاونكم مع Aeris.
      </p>
    </div>
  );
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_input':
      return 'البيانات غير مكتملة أو غير صحيحة. راجع الحقول المطلوبة.';
    case 'token_invalid':
    case 'trip_not_found':
    case 'trip_closed':
    case 'token_stale':
      return 'هذا الرابط لم يعد صالحًا. يرجى طلب رابط جديد من المؤسس.';
    case 'failed':
    default:
      return 'تعذّر إرسال العرض الآن. حاول مرة أخرى.';
  }
}
