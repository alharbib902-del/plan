'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { medevacAr } from '@/lib/i18n/medevac-ar';
import { submitMedevacRequestAuthed } from '@/app/actions/medevac-clients';
import type { MedevacSubscriptionRow } from '@/lib/medevac/types';

interface Props {
  activeSubscription: MedevacSubscriptionRow | null;
  defaultClientName: string;
  defaultClientPhone: string;
}

const SERVICE_LEVELS = [
  { value: 'BMT', label: medevacAr.serviceBmt },
  { value: 'ALS', label: medevacAr.serviceAls },
  { value: 'CCT', label: medevacAr.serviceCct },
  { value: 'repatriation', label: medevacAr.serviceRepat },
] as const;

const SEVERITIES = [
  { value: 'stable', label: medevacAr.severityStable },
  { value: 'moderate', label: medevacAr.severityModerate },
  { value: 'critical', label: medevacAr.severityCritical },
] as const;

const ERROR_COPY: Record<string, string> = {
  flag_disabled: medevacAr.errorFlagDisabled,
  unauthorized: 'الجلسة منتهية — سجّل الدخول من جديد',
  validation_failed: medevacAr.errorValidationFailed,
  ip_required: medevacAr.errorIpRequired,
  server_error: medevacAr.errorServerError,
  use_subscription_must_route_to_shield_rpc:
    'خطأ داخلي في توجيه طلب Shield (راسل الدعم).',
  subscription_not_owned: 'هذا الاشتراك ليس مسجلاً باسمك.',
  subscription_not_consumable:
    'الاشتراك غير قابل للاستخدام (انتهى أو نفدت الأحداث المغطاة).',
  patient_not_covered: 'المريض غير مسجَّل في قائمة الأعضاء المُغطَّيْن.',
  patient_dob_invalid: 'تاريخ ميلاد المريض غير صحيح.',
  service_level_not_entitled:
    'خطتك لا تشمل هذا المستوى من الخدمة الطبية.',
  shield_default_operator_missing:
    'لم يتم تهيئة المشغل الافتراضي لـ Aeris Shield. تواصل مع الإدارة.',
  shield_default_operator_not_approved:
    'المشغل الافتراضي معطّل مؤقتاً. تواصل مع الإدارة.',
  shield_default_operator_not_certified:
    'لا يوجد طائرة معتمدة لهذا المستوى من الخدمة حالياً.',
  shield_default_operator_missing_contact:
    'بيانات المشغل الافتراضي ناقصة. تواصل مع الإدارة.',
};

export function MedevacAuthedForm({
  activeSubscription,
  defaultClientName,
  defaultClientPhone,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<{
    medevac_request_number: string;
    shield_consumed?: boolean;
    covered_events_remaining?: number;
  } | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [useShield, setUseShield] = useState(false);

  const canUseShield =
    activeSubscription !== null &&
    (activeSubscription.covered_events_at_signup === -1 ||
      activeSubscription.used_events <
        activeSubscription.covered_events_at_signup);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setTopError(null);
    setFieldErrors({});

    const fd = new FormData(e.currentTarget);
    const ageRaw = (fd.get('patient_age') ?? '').toString().trim();
    const estRaw = (fd.get('estimated_value_sar') ?? '').toString().trim();

    const basePayload = {
      patient_name: (fd.get('patient_name') ?? '').toString(),
      patient_age: ageRaw === '' ? null : Number.parseInt(ageRaw, 10),
      contact_name: (fd.get('contact_name') ?? '').toString(),
      contact_phone: (fd.get('contact_phone') ?? '').toString(),
      contact_email:
        ((fd.get('contact_email') ?? '').toString() || null),
      condition_severity: (fd.get('condition_severity') ?? '').toString(),
      service_level: (fd.get('service_level') ?? '').toString(),
      from_location_freeform: (
        fd.get('from_location_freeform') ?? ''
      ).toString(),
      from_iata: ((fd.get('from_iata') ?? '').toString() || null),
      to_hospital_name: (fd.get('to_hospital_name') ?? '').toString(),
      to_hospital_contact_phone:
        ((fd.get('to_hospital_contact_phone') ?? '').toString() || null),
      to_hospital_freeform_address:
        ((fd.get('to_hospital_freeform_address') ?? '').toString() || null),
      to_iata: ((fd.get('to_iata') ?? '').toString() || null),
      insurance_provider:
        ((fd.get('insurance_provider') ?? '').toString() || null),
      insurance_claim_ref:
        ((fd.get('insurance_claim_ref') ?? '').toString() || null),
      estimated_value_sar: estRaw === '' ? NaN : Number(estRaw),
    };

    const payload: Record<string, unknown> = { ...basePayload };
    if (useShield && activeSubscription) {
      payload['use_subscription'] = true;
      payload['subscription_id'] = activeSubscription.id;
      payload['patient_member_name'] = (
        fd.get('patient_member_name') ?? ''
      ).toString();
      payload['patient_member_dob'] = (
        fd.get('patient_member_dob') ?? ''
      ).toString();
    }

    try {
      const result = await submitMedevacRequestAuthed(payload);
      if (result.ok) {
        setSuccess({
          medevac_request_number: result.medevac_request_number,
          shield_consumed: result.shield_consumed,
          covered_events_remaining: result.covered_events_remaining,
        });
        e.currentTarget.reset();
        router.refresh();
      } else {
        if (result.field_errors) setFieldErrors(result.field_errors);
        setTopError(ERROR_COPY[result.error] ?? medevacAr.errorGeneric);
      }
    } catch (err) {
      console.error('[medevac-authed-form] submit threw', err);
      setTopError(medevacAr.errorGeneric);
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
        <h2 className="font-ar text-2xl text-emerald-300">
          {medevacAr.successHeading}
        </h2>
        <p className="font-ar mt-4 text-base text-ink-secondary">
          {success.shield_consumed
            ? 'تم استهلاك حدث Shield مغطّى. سيتواصل معك المشغل الافتراضي مباشرة.'
            : medevacAr.successBody}
        </p>
        <p className="font-ar mt-6 text-sm text-ink-secondary">
          رقم الطلب:{' '}
          <span dir="ltr" className="font-mono text-emerald-200">
            {success.medevac_request_number}
          </span>
        </p>
        {success.shield_consumed && (
          <p className="font-ar mt-2 text-xs text-ink-muted">
            الأحداث المتبقية:{' '}
            <span dir="ltr">
              {success.covered_events_remaining === -1
                ? '∞'
                : success.covered_events_remaining}
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {topError && (
        <p
          role="alert"
          className="font-ar rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
        >
          {topError}
        </p>
      )}

      {canUseShield && (
        <label className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <input
            type="checkbox"
            checked={useShield}
            onChange={(e) => setUseShield(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-emerald-400"
          />
          <span className="font-ar text-sm text-emerald-200">
            استخدام حدث مغطى من اشتراك Aeris Shield (
            <span dir="ltr">
              {activeSubscription?.subscription_number}
            </span>
            )
          </span>
        </label>
      )}

      {useShield && (
        <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="font-ar text-xs text-emerald-200">
            اختر العضو المُغطَّى — يجب أن يكون اسمه + تاريخ ميلاده مسجلين في
            قائمة الأعضاء المُغطَّيْن لاشتراكك.
          </p>
          <Field
            name="patient_member_name"
            label="اسم العضو المغطى (كما هو في الاشتراك)"
            type="text"
            required
            error={fieldErrors['patient_member_name']}
          />
          <Field
            name="patient_member_dob"
            label="تاريخ ميلاد العضو المغطى"
            type="date"
            required
            error={fieldErrors['patient_member_dob']}
          />
        </div>
      )}

      <Field
        name="patient_name"
        label={medevacAr.patientName}
        type="text"
        required
        error={fieldErrors['patient_name']}
      />
      <Field
        name="patient_age"
        label={medevacAr.patientAge}
        type="number"
        min={0}
        max={130}
        error={fieldErrors['patient_age']}
      />
      <Field
        name="contact_name"
        label={medevacAr.contactName}
        type="text"
        required
        defaultValue={defaultClientName}
        error={fieldErrors['contact_name']}
      />
      <Field
        name="contact_phone"
        label={medevacAr.contactPhone}
        type="tel"
        required
        defaultValue={defaultClientPhone}
        error={fieldErrors['contact_phone']}
      />
      <Field
        name="contact_email"
        label={medevacAr.contactEmail}
        type="email"
        error={fieldErrors['contact_email']}
      />

      <Select
        name="condition_severity"
        label={medevacAr.conditionSeverity}
        options={SEVERITIES.map((s) => ({
          value: s.value,
          label: s.label,
        }))}
        required
        error={fieldErrors['condition_severity']}
      />

      <Select
        name="service_level"
        label={medevacAr.serviceLevel}
        options={SERVICE_LEVELS.map((s) => ({
          value: s.value,
          label: s.label,
        }))}
        required
        error={fieldErrors['service_level']}
      />

      <Field
        name="from_location_freeform"
        label={medevacAr.fromLocation}
        type="text"
        required
        error={fieldErrors['from_location_freeform']}
      />
      <Field
        name="from_iata"
        label={medevacAr.fromIata}
        type="text"
        maxLength={4}
        error={fieldErrors['from_iata']}
      />
      <Field
        name="to_hospital_name"
        label={medevacAr.toHospitalName}
        type="text"
        required
        error={fieldErrors['to_hospital_name']}
      />
      <Field
        name="to_hospital_contact_phone"
        label={medevacAr.toHospitalContactPhone}
        type="tel"
        error={fieldErrors['to_hospital_contact_phone']}
      />
      <Field
        name="to_hospital_freeform_address"
        label={medevacAr.toHospitalAddress}
        type="text"
        error={fieldErrors['to_hospital_freeform_address']}
      />
      <Field
        name="to_iata"
        label={medevacAr.toIata}
        type="text"
        maxLength={4}
        error={fieldErrors['to_iata']}
      />
      <Field
        name="insurance_provider"
        label={medevacAr.insuranceProvider}
        type="text"
        error={fieldErrors['insurance_provider']}
      />
      <Field
        name="insurance_claim_ref"
        label={medevacAr.insuranceClaimRef}
        type="text"
        error={fieldErrors['insurance_claim_ref']}
      />
      <Field
        name="estimated_value_sar"
        label={medevacAr.estimatedValue}
        type="number"
        min={0}
        step={100}
        required
        error={fieldErrors['estimated_value_sar']}
      />

      <button
        type="submit"
        disabled={pending}
        className="font-ar w-full rounded-xl bg-gold py-3 text-lg font-medium text-navy hover:opacity-90 disabled:opacity-50"
      >
        {pending ? medevacAr.submitting : medevacAr.submit}
      </button>
    </form>
  );
}

interface FieldProps {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  defaultValue?: string;
  error?: string;
}

function Field(props: FieldProps) {
  const { name, label, type, required, error, ...rest } = props;
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-2 block text-sm text-ink-secondary"
      >
        {label}
        {required && <span className="ms-1 text-rose-400">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        dir={type === 'tel' || type === 'email' || type === 'date' ? 'ltr' : undefined}
        className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
        {...rest}
      />
      {error && <p className="font-ar mt-1 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

interface SelectProps {
  name: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  required?: boolean;
  error?: string;
}

function Select({ name, label, options, required, error }: SelectProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-2 block text-sm text-ink-secondary"
      >
        {label}
        {required && <span className="ms-1 text-rose-400">*</span>}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        defaultValue=""
        className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
      >
        <option value="" disabled>
          —
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="font-ar mt-1 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
