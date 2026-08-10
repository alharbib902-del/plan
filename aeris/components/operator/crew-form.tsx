'use client';

import { useState, useTransition } from 'react';

import { operatorsAr } from '@/lib/i18n/operators-ar';
import { createCrew, updateCrew } from '@/app/actions/operators-crew';
import type { OperatorCrewRow } from '@/lib/operators/crew';
import { OperatorBanner, operatorErrorMessage } from './error-banner';

const ar = operatorsAr.portal.crew;

const ROLE_OPTIONS = (
  ['captain', 'first_officer', 'flight_attendant'] as const
).map((r) => ({ value: r, label: ar.roles[r] }));

function splitCsv(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function CrewForm({
  mode,
  initial,
  onSuccess,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: OperatorCrewRow;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrorCode(null);
    setFieldErrors({});

    const common = {
      full_name: String(fd.get('full_name') ?? ''),
      role: String(fd.get('role') ?? ''),
      nationality: String(fd.get('nationality') ?? ''),
      languages: splitCsv(String(fd.get('languages') ?? '')),
      specializations: splitCsv(String(fd.get('specializations') ?? '')),
      experience_hours: String(fd.get('experience_hours') ?? ''),
      license_number: String(fd.get('license_number') ?? ''),
      license_expiry: String(fd.get('license_expiry') ?? ''),
      extra_fee: String(fd.get('extra_fee') ?? ''),
    };

    startTransition(async () => {
      const result =
        mode === 'create'
          ? await createCrew(common)
          : await updateCrew({ crew_id: initial?.id ?? '', ...common });
      if (result.ok) {
        onSuccess();
        return;
      }
      setErrorCode(result.error);
      if ('field_errors' in result && result.field_errors) {
        setFieldErrors(result.field_errors);
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-border bg-navy-card/40 p-5"
    >
      <h3 className="font-ar text-base text-ink-primary">
        {mode === 'create' ? ar.addTitle : ar.editTitle}
      </h3>
      {errorCode ? (
        <OperatorBanner kind="error">
          {operatorErrorMessage(errorCode)}
        </OperatorBanner>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={ar.labels.full_name}
          name="full_name"
          required
          defaultValue={initial?.full_name}
          error={fieldErrors.full_name}
        />
        <SelectField
          label={ar.labels.role}
          name="role"
          options={ROLE_OPTIONS}
          defaultValue={initial?.role ?? 'captain'}
          error={fieldErrors.role}
        />
        <Field
          label={ar.labels.nationality}
          name="nationality"
          defaultValue={initial?.nationality ?? undefined}
          error={fieldErrors.nationality}
        />
        <Field
          label={ar.labels.languages}
          name="languages"
          defaultValue={initial?.languages.join('، ')}
          error={fieldErrors.languages}
        />
        <Field
          label={ar.labels.specializations}
          name="specializations"
          defaultValue={initial?.specializations.join('، ')}
          error={fieldErrors.specializations}
        />
        <Field
          label={ar.labels.experience_hours}
          name="experience_hours"
          type="number"
          dir="ltr"
          defaultValue={initial?.experience_hours?.toString()}
          error={fieldErrors.experience_hours}
        />
        <Field
          label={ar.labels.license_number}
          name="license_number"
          dir="ltr"
          defaultValue={initial?.license_number ?? undefined}
          error={fieldErrors.license_number}
        />
        <Field
          label={ar.labels.license_expiry}
          name="license_expiry"
          type="date"
          dir="ltr"
          defaultValue={initial?.license_expiry ?? undefined}
          error={fieldErrors.license_expiry}
        />
        <Field
          label={ar.labels.extra_fee}
          name="extra_fee"
          type="number"
          dir="ltr"
          defaultValue={initial?.extra_fee?.toString()}
          error={fieldErrors.extra_fee}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="font-ar rounded-lg border border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
        >
          {isPending ? ar.saving : ar.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="font-ar rounded-lg border border-border px-4 py-2 text-sm text-ink-secondary transition-colors hover:text-ink disabled:opacity-60"
        >
          {ar.cancel}
        </button>
      </div>
    </form>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  dir?: 'ltr' | 'rtl';
  defaultValue?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={props.name} className="font-ar mb-1 block text-xs text-ink-muted">
        {props.label}
      </label>
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? 'text'}
        dir={props.dir}
        defaultValue={props.defaultValue}
        required={props.required}
        className={`font-ar w-full rounded-lg border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:outline-none ${
          props.error ? 'border-rose-500/60' : 'border-border focus:border-gold/50'
        }`}
      />
      {props.error ? (
        <p className="font-ar mt-1 text-xs text-rose-200">{props.error}</p>
      ) : null}
    </div>
  );
}

function SelectField(props: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={props.name} className="font-ar mb-1 block text-xs text-ink-muted">
        {props.label}
      </label>
      <select
        id={props.name}
        name={props.name}
        defaultValue={props.defaultValue}
        className={`font-ar w-full rounded-lg border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:outline-none ${
          props.error ? 'border-rose-500/60' : 'border-border focus:border-gold/50'
        }`}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {props.error ? (
        <p className="font-ar mt-1 text-xs text-rose-200">{props.error}</p>
      ) : null}
    </div>
  );
}
