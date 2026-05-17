'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { medevacAr } from '@/lib/i18n/medevac-ar';
import { submitMedevacRequestPublic } from '@/app/actions/medevac-public';

/**
 * Phase 12 PR 1 — public /medevac intake form.
 *
 * Anonymous browser surface. Submits to
 * submitMedevacRequestPublic Server Action, which:
 *   - Validates via medevacRequestPublicSchema (enforces
 *     severity='stable' at the Zod boundary per D1)
 *   - Calls §4.1 create_medevac_request_guest RPC
 *   - Returns { ok: true, medevac_request_id, medevac_request_number }
 *     or a structured error
 *
 * Severity is hard-locked to 'stable' on the public path —
 * moderate/critical require an authed account (the form
 * renders the lock notice prominently). The dropdown is
 * disabled to make the contract visible.
 */

const SERVICE_LEVEL_OPTIONS = [
  { value: 'BMT', label: medevacAr.serviceBmt },
  { value: 'ALS', label: medevacAr.serviceAls },
  { value: 'CCT', label: medevacAr.serviceCct },
  { value: 'repatriation', label: medevacAr.serviceRepat },
] as const;

type ErrorMap = Record<string, string>;

const ERROR_COPY: Record<string, string> = {
  flag_disabled: medevacAr.errorFlagDisabled,
  severity_requires_account: medevacAr.errorSeverityRequiresAccount,
  ip_required: medevacAr.errorIpRequired,
  validation_failed: medevacAr.errorValidationFailed,
  server_error: medevacAr.errorServerError,
};

interface SuccessState {
  medevac_request_id: string;
  medevac_request_number: string;
}

export function MedevacRequestForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ErrorMap>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setTopError(null);
    setFieldErrors({});

    const form = event.currentTarget;
    const fd = new FormData(form);

    const ageRaw = (fd.get('patient_age') ?? '').toString().trim();
    const estimatedRaw = (fd.get('estimated_value_sar') ?? '')
      .toString()
      .trim();

    const payload = {
      patient_name: (fd.get('patient_name') ?? '').toString(),
      patient_age:
        ageRaw === '' ? null : Number.parseInt(ageRaw, 10),
      contact_name: (fd.get('contact_name') ?? '').toString(),
      contact_phone: (fd.get('contact_phone') ?? '').toString(),
      contact_email: ((fd.get('contact_email') ?? '').toString() || null),
      condition_severity: 'stable' as const,
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
      estimated_value_sar:
        estimatedRaw === '' ? NaN : Number(estimatedRaw),
    };

    try {
      const result = await submitMedevacRequestPublic(payload);
      if (result.ok) {
        setSuccess({
          medevac_request_id: result.medevac_request_id,
          medevac_request_number: result.medevac_request_number,
        });
        form.reset();
        router.refresh();
      } else {
        if (result.field_errors) setFieldErrors(result.field_errors);
        setTopError(ERROR_COPY[result.error] ?? medevacAr.errorGeneric);
      }
    } catch (err) {
      console.error('[medevac-request-form] submit threw', err);
      setTopError(medevacAr.errorGeneric);
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center"
      >
        <h2 className="font-ar text-2xl text-emerald-300">
          {medevacAr.successHeading}
        </h2>
        <p className="font-ar mt-4 text-base text-ink-secondary">
          {medevacAr.successBody}
        </p>
        <p className="font-ar mt-6 text-sm text-ink-secondary">
          {medevacAr.successReferencePrefix}{' '}
          <span dir="ltr" className="font-mono text-emerald-200">
            {success.medevac_request_number}
          </span>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <p
        role="note"
        className="font-ar rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm leading-7 text-gold-light"
      >
        {medevacAr.publicSeverityLockNote}
      </p>

      {topError && (
        <p
          role="alert"
          className="font-ar rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
        >
          {topError}
        </p>
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
        error={fieldErrors['contact_name']}
      />
      <Field
        name="contact_phone"
        label={medevacAr.contactPhone}
        type="tel"
        required
        error={fieldErrors['contact_phone']}
      />
      <Field
        name="contact_email"
        label={medevacAr.contactEmail}
        type="email"
        error={fieldErrors['contact_email']}
      />

      <fieldset>
        <label className="font-ar mb-2 block text-sm text-ink-secondary">
          {medevacAr.conditionSeverity}
        </label>
        <select
          name="condition_severity"
          value="stable"
          disabled
          className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary opacity-70"
        >
          <option value="stable">{medevacAr.severityStable}</option>
        </select>
      </fieldset>

      <fieldset>
        <label
          className="font-ar mb-2 block text-sm text-ink-secondary"
          htmlFor="service_level"
        >
          {medevacAr.serviceLevel}
        </label>
        <select
          id="service_level"
          name="service_level"
          required
          defaultValue=""
          className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
        >
          <option value="" disabled>
            —
          </option>
          {SERVICE_LEVEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {fieldErrors['service_level'] && (
          <p className="font-ar mt-1 text-xs text-rose-300">
            {fieldErrors['service_level']}
          </p>
        )}
      </fieldset>

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
        className="font-ar w-full rounded-xl bg-gold py-3 text-lg font-medium text-navy transition-opacity hover:opacity-90 disabled:opacity-50"
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
        dir={type === 'tel' || type === 'email' ? 'ltr' : undefined}
        className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary placeholder:text-ink-secondary/50 focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/30"
        {...rest}
      />
      {error && (
        <p className="font-ar mt-1 text-xs text-rose-300">{error}</p>
      )}
    </div>
  );
}
