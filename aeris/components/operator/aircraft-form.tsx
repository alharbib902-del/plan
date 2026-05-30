'use client';

import { useState, useTransition } from 'react';

import { operatorsAr } from '@/lib/i18n/operators-ar';
import { createAircraft, updateAircraft } from '@/app/actions/operators-fleet';
import type { OperatorAircraftRow } from '@/lib/operators/fleet';
import { OperatorBanner, operatorErrorMessage } from './error-banner';

const ar = operatorsAr.portal.fleet;

const CATEGORY_OPTIONS = (
  ['light', 'mid', 'super_mid', 'heavy', 'long_range'] as const
).map((c) => ({ value: c, label: ar.categories[c] }));

const STATUS_OPTIONS = (['active', 'maintenance'] as const).map((s) => ({
  value: s,
  label: ar.statuses[s],
}));

export function AircraftForm({
  mode,
  initial,
  onSuccess,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: OperatorAircraftRow;
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
      manufacturer: String(fd.get('manufacturer') ?? ''),
      model: String(fd.get('model') ?? ''),
      category: String(fd.get('category') ?? ''),
      year: String(fd.get('year') ?? ''),
      max_passengers: String(fd.get('max_passengers') ?? ''),
      max_range_km: String(fd.get('max_range_km') ?? ''),
      base_hourly_rate: String(fd.get('base_hourly_rate') ?? ''),
      is_cargo_capable: fd.get('is_cargo_capable') === 'on',
      is_medevac_capable: fd.get('is_medevac_capable') === 'on',
    };

    startTransition(async () => {
      const result =
        mode === 'create'
          ? await createAircraft({
              registration: String(fd.get('registration') ?? ''),
              ...common,
            })
          : await updateAircraft({
              aircraft_id: initial?.id ?? '',
              status: String(fd.get('status') ?? 'active'),
              ...common,
            });
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
        {mode === 'create' ? (
          <Field
            label={ar.labels.registration}
            name="registration"
            dir="ltr"
            required
            error={fieldErrors.registration}
          />
        ) : (
          <div>
            <label className="font-ar mb-1 block text-xs text-ink-muted">
              {ar.labels.registration}
            </label>
            <input
              dir="ltr"
              value={initial?.registration ?? ''}
              disabled
              className="w-full cursor-not-allowed rounded-lg border border-border/40 bg-navy-secondary/30 px-3 py-2 text-sm text-ink-muted"
            />
            <p className="font-ar mt-1 text-xs text-ink-muted">
              {ar.registrationImmutableHint}
            </p>
          </div>
        )}
        <Field
          label={ar.labels.manufacturer}
          name="manufacturer"
          required
          defaultValue={initial?.manufacturer}
          error={fieldErrors.manufacturer}
        />
        <Field
          label={ar.labels.model}
          name="model"
          required
          defaultValue={initial?.model}
          error={fieldErrors.model}
        />
        <SelectField
          label={ar.labels.category}
          name="category"
          options={CATEGORY_OPTIONS}
          defaultValue={initial?.category ?? 'light'}
          error={fieldErrors.category}
        />
        <Field
          label={ar.labels.year}
          name="year"
          type="number"
          dir="ltr"
          defaultValue={initial?.year?.toString()}
          error={fieldErrors.year}
        />
        <Field
          label={ar.labels.max_passengers}
          name="max_passengers"
          type="number"
          dir="ltr"
          required
          defaultValue={initial?.max_passengers?.toString()}
          error={fieldErrors.max_passengers}
        />
        <Field
          label={ar.labels.max_range_km}
          name="max_range_km"
          type="number"
          dir="ltr"
          defaultValue={initial?.max_range_km?.toString()}
          error={fieldErrors.max_range_km}
        />
        <Field
          label={ar.labels.base_hourly_rate}
          name="base_hourly_rate"
          type="number"
          dir="ltr"
          required
          defaultValue={initial?.base_hourly_rate?.toString()}
          error={fieldErrors.base_hourly_rate}
        />
        {mode === 'edit' ? (
          <SelectField
            label={ar.labels.status}
            name="status"
            options={STATUS_OPTIONS}
            defaultValue={
              initial?.status === 'maintenance' ? 'maintenance' : 'active'
            }
            error={fieldErrors.status}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-5">
        <Checkbox
          name="is_cargo_capable"
          label={ar.labels.is_cargo_capable}
          defaultChecked={initial?.is_cargo_capable ?? false}
        />
        <Checkbox
          name="is_medevac_capable"
          label={ar.labels.is_medevac_capable}
          defaultChecked={initial?.is_medevac_capable ?? false}
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
      <label className="font-ar mb-1 block text-xs text-ink-muted">
        {props.label}
      </label>
      <input
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
      <label className="font-ar mb-1 block text-xs text-ink-muted">
        {props.label}
      </label>
      <select
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

function Checkbox(props: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="font-ar flex items-center gap-2 text-sm text-ink-secondary">
      <input
        type="checkbox"
        name={props.name}
        defaultChecked={props.defaultChecked}
        className="h-4 w-4 accent-gold"
      />
      <span>{props.label}</span>
    </label>
  );
}
