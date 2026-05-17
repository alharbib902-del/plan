'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { submitMedevacOffer } from '@/app/actions/medevac-operators';
import {
  datetimeLocalToRiyadhIso,
} from '@/lib/utils/datetime-local';

interface AircraftOption {
  id: string;
  label: string;
}

interface Props {
  requestId: string;
  serviceLevel: string;
  aircraftOptions: AircraftOption[];
}

const ERROR_COPY: Record<string, string> = {
  flag_disabled: 'الخدمة غير مفعلة',
  validation_failed: 'البيانات غير صحيحة',
  server_error: 'خطأ في الخادم',
  must_change_password_first: 'يجب تغيير كلمة السر أولاً',
  operator_not_approved: 'حساب المشغل لم يتم اعتماده',
  medevac_request_id_required: 'معرّف الطلب مطلوب',
  medevac_request_id_invalid: 'معرّف الطلب غير صحيح',
  medevac_request_not_found: 'الطلب غير موجود',
  medevac_request_not_open: 'الطلب لم يعد مفتوحاً للعروض',
  medevac_request_expired: 'الطلب منتهي الصلاحية',
  aircraft_id_required: 'الطائرة مطلوبة',
  aircraft_id_invalid: 'معرّف الطائرة غير صحيح',
  aircraft_not_found: 'الطائرة غير موجودة',
  aircraft_not_owned: 'هذه الطائرة ليست في أسطولك',
  aircraft_no_medical_certification:
    'هذه الطائرة بدون شهادة طبية مسجلة',
  aircraft_certification_expired: 'شهادة الطائرة الطبية منتهية',
  aircraft_capability_missing:
    'هذه الطائرة لا تدعم مستوى الخدمة المطلوب',
  base_price_required: 'السعر الأساسي مطلوب',
  base_price_invalid: 'السعر الأساسي غير صحيح',
  medical_team_price_invalid: 'سعر الطاقم الطبي غير صحيح',
  insurance_coordination_price_invalid: 'سعر تنسيق التأمين غير صحيح',
  proposed_pickup_at_required: 'موعد الإقلاع مطلوب',
  proposed_pickup_at_invalid: 'موعد الإقلاع غير صحيح',
  proposed_arrival_at_required: 'موعد الوصول مطلوب',
  proposed_arrival_at_invalid: 'موعد الوصول غير صحيح',
  proposed_pickup_must_be_future: 'موعد الإقلاع يجب أن يكون في المستقبل',
  proposed_arrival_after_pickup:
    'موعد الوصول يجب أن يكون بعد موعد الإقلاع',
};

export function OperatorOfferForm({
  requestId,
  serviceLevel,
  aircraftOptions,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setTopError(null);
    setFieldErrors({});

    const fd = new FormData(e.currentTarget);
    const pickupLocal = (fd.get('proposed_pickup_at') ?? '').toString();
    const arrivalLocal = (fd.get('proposed_arrival_at') ?? '').toString();

    const payload = {
      medevac_request_id: requestId,
      aircraft_id: (fd.get('aircraft_id') ?? '').toString(),
      aircraft_snapshot:
        ((fd.get('aircraft_snapshot') ?? '').toString() || null),
      medical_team_snapshot:
        ((fd.get('medical_team_snapshot') ?? '').toString() || null),
      base_price_sar: Number((fd.get('base_price_sar') ?? '').toString()),
      medical_team_price_sar: Number(
        (fd.get('medical_team_price_sar') ?? '0').toString()
      ),
      insurance_coordination_price_sar: Number(
        (fd.get('insurance_coordination_price_sar') ?? '0').toString()
      ),
      proposed_pickup_at: pickupLocal
        ? datetimeLocalToRiyadhIso(pickupLocal)
        : '',
      proposed_arrival_at: arrivalLocal
        ? datetimeLocalToRiyadhIso(arrivalLocal)
        : '',
      operator_notes:
        ((fd.get('operator_notes') ?? '').toString() || null),
    };

    try {
      const result = await submitMedevacOffer(payload);
      if (result.ok) {
        setSuccess(true);
        router.refresh();
      } else {
        if (result.field_errors) setFieldErrors(result.field_errors);
        setTopError(ERROR_COPY[result.error] ?? 'خطأ غير متوقع');
      }
    } catch (err) {
      console.error('[operator-offer-form] submit threw', err);
      setTopError('خطأ غير متوقع');
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
        <h2 className="font-ar text-xl text-emerald-300">
          تم إرسال العرض ✓
        </h2>
        <p className="font-ar mt-3 text-sm text-ink-secondary">
          سيظهر العرض في قائمة عروضك. ينتظر الآن قرار العميل.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {topError && (
        <p
          role="alert"
          className="font-ar rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"
        >
          {topError}
        </p>
      )}

      <p className="font-ar rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-200">
        مستوى الخدمة المطلوب:{' '}
        <span dir="ltr" className="font-mono">
          {serviceLevel}
        </span>{' '}
        — الطائرة المختارة يجب أن تكون معتمدة طبياً لهذا المستوى
        وشهادتها سارية.
      </p>

      <div>
        <label className="font-ar mb-1 block text-sm text-ink-secondary">
          الطائرة <span className="text-rose-400">*</span>
        </label>
        <select
          name="aircraft_id"
          required
          defaultValue=""
          className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
        >
          <option value="" disabled>
            —
          </option>
          {aircraftOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        {fieldErrors['aircraft_id'] && (
          <p className="font-ar mt-1 text-xs text-rose-300">
            {fieldErrors['aircraft_id']}
          </p>
        )}
      </div>

      <Text name="aircraft_snapshot" label="وصف الطائرة (اختياري)" />
      <Text
        name="medical_team_snapshot"
        label='الطاقم الطبي (مثال: "طبيب + ممرضين")'
      />

      <NumberField
        name="base_price_sar"
        label="السعر الأساسي (ريال)"
        required
      />
      <NumberField
        name="medical_team_price_sar"
        label="سعر الطاقم الطبي (ريال)"
        defaultValue={0}
      />
      <NumberField
        name="insurance_coordination_price_sar"
        label="سعر تنسيق التأمين (ريال)"
        defaultValue={0}
      />

      <DateTime
        name="proposed_pickup_at"
        label="موعد الإقلاع المقترح"
        required
      />
      <DateTime
        name="proposed_arrival_at"
        label="موعد الوصول المقترح"
        required
      />

      <div>
        <label className="font-ar mb-1 block text-sm text-ink-secondary">
          ملاحظات (اختياري، ≤ 1000 حرف)
        </label>
        <textarea
          name="operator_notes"
          maxLength={1000}
          rows={3}
          className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="font-ar w-full rounded-xl bg-gold py-3 text-base font-medium text-navy hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'جاري الإرسال…' : 'إرسال العرض'}
      </button>
    </form>
  );
}

function Text({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="font-ar mb-1 block text-sm text-ink-secondary">
        {label}
        {required && <span className="ms-1 text-rose-400">*</span>}
      </label>
      <input
        name={name}
        type="text"
        required={required}
        className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
      />
    </div>
  );
}

function NumberField({
  name,
  label,
  required,
  defaultValue,
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: number;
}) {
  return (
    <div>
      <label className="font-ar mb-1 block text-sm text-ink-secondary">
        {label}
        {required && <span className="ms-1 text-rose-400">*</span>}
      </label>
      <input
        name={name}
        type="number"
        min={0}
        step={100}
        required={required}
        defaultValue={defaultValue}
        dir="ltr"
        className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
      />
    </div>
  );
}

function DateTime({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="font-ar mb-1 block text-sm text-ink-secondary">
        {label}
        {required && <span className="ms-1 text-rose-400">*</span>}
      </label>
      <input
        name={name}
        type="datetime-local"
        required={required}
        dir="ltr"
        className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
      />
    </div>
  );
}
