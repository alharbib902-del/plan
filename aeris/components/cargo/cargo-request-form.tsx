'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';

import { cargoAr } from '@/lib/i18n/cargo-ar';
import { submitCargoRequestPublic } from '@/app/actions/cargo-public';
import { submitCargoRequestAuthed } from '@/app/actions/cargo-clients';
import type { CargoType } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 + PR 2 — cargo intake form.
 *
 * 4-stage layout:
 *   1. Cargo type selector (4 options + descriptions)
 *   2. Customer fields (name, phone, email) — only when mode='guest'
 *   3. Shared shipment fields (origin, destination, dates, value)
 *   4. Per-category conditional fields (renders based on
 *      selected cargo_type)
 *
 * `mode` prop controls:
 *   - 'guest' (default, PR 1): renders customer fields, submits
 *     to submitCargoRequestPublic → §4.1 create_cargo_request_guest.
 *     Success shows CGO-XXXX + login CTA.
 *   - 'authed' (PR 2): hides customer fields (the §4.2 RPC sources
 *     them from the clients table at session.client_id), submits
 *     to submitCargoRequestAuthed. Success shows CGO-XXXX +
 *     "view request" CTA.
 *
 * One file, two modes — keeps the per-category branching logic
 * single-source and avoids drift between two parallel forms.
 *
 * Uses native HTML inputs (no react-hook-form) to keep PR 1/2
 * scope contained; field names match the Server Actions' Zod
 * payload shapes exactly.
 */

const CARGO_TYPES: CargoType[] = ['horse', 'luxury_car', 'valuables', 'other'];

export type CargoFormMode = 'guest' | 'authed';

interface SuccessState {
  cargo_request_id: string;
  cargo_request_number: string;
}

export interface CargoRequestFormProps {
  /** Defaults to 'guest' for backwards compat with PR 1 callers. */
  mode?: CargoFormMode;
}

export function CargoRequestForm({
  mode = 'guest',
}: CargoRequestFormProps = {}) {
  const [cargoType, setCargoType] = useState<CargoType>('horse');
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Build the payload matching cargoRequestPublicSchema.
    // Use FormDataEntryValue → string conversion + parse
    // numerics inline so the Server Action receives Zod-friendly
    // types. Empty strings → undefined so Zod's `.optional()`
    // applies and the DB-side NULLIF guards (round 8 P2 #2)
    // can default appropriately.
    const v = (key: string): string | undefined => {
      const raw = fd.get(key);
      if (raw === null) return undefined;
      const s = String(raw).trim();
      return s.length > 0 ? s : undefined;
    };
    const num = (key: string): number | undefined => {
      const s = v(key);
      if (s === undefined) return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    };
    const bool = (key: string): boolean | undefined => {
      const raw = fd.get(key);
      return raw === 'on' || raw === 'true' ? true : undefined;
    };

    // Per-category fields conditional based on cargoType
    const categoryFields: Record<string, unknown> = {};
    if (cargoType === 'horse') {
      categoryFields.horse_count = num('horse_count');
      categoryFields.horse_groom_required = bool('horse_groom_required');
      categoryFields.horse_cites_status = v('horse_cites_status');
      categoryFields.horse_stall_requirements = v('horse_stall_requirements');
    } else if (cargoType === 'luxury_car') {
      categoryFields.car_make = v('car_make');
      categoryFields.car_model = v('car_model');
      categoryFields.car_year = num('car_year');
      categoryFields.car_running_condition = bool('car_running_condition');
      categoryFields.car_enclosed_required = bool('car_enclosed_required');
    } else if (cargoType === 'valuables') {
      categoryFields.valuables_declared_value_sar = num(
        'valuables_declared_value_sar'
      );
      categoryFields.valuables_security_level = v('valuables_security_level');
      categoryFields.valuables_climate_controlled = bool(
        'valuables_climate_controlled'
      );
      categoryFields.valuables_item_description = v(
        'valuables_item_description'
      );
    } else {
      categoryFields.other_description = v('other_description');
      categoryFields.other_dimensions_lwh_cm = v('other_dimensions_lwh_cm');
      categoryFields.other_weight_kg = num('other_weight_kg');
      categoryFields.other_special_handling = v('other_special_handling');
    }

    // Build payload. Customer fields included only in guest mode;
    // in authed mode the §4.2 RPC sources name/phone/email from the
    // clients table.
    const sharedPayload = {
      cargo_type: cargoType,
      origin_iata: v('origin_iata')?.toUpperCase(),
      origin_freeform: v('origin_freeform'),
      destination_iata: v('destination_iata')?.toUpperCase(),
      destination_freeform: v('destination_freeform'),
      pickup_date: v('pickup_date'),
      delivery_date_target: v('delivery_date_target'),
      flexibility_days: num('flexibility_days') ?? 0,
      estimated_value_sar: num('estimated_value_sar'),
      insurance_required: bool('insurance_required') ?? false,
      handling_notes: v('handling_notes'),
      ...categoryFields,
    };
    const payload =
      mode === 'guest'
        ? {
            ...sharedPayload,
            customer_name: v('customer_name'),
            customer_phone: v('customer_phone'),
            customer_email: v('customer_email'),
          }
        : sharedPayload;

    setErrorCode(null);
    setFieldErrors({});
    startTransition(async () => {
      const result =
        mode === 'guest'
          ? await submitCargoRequestPublic(payload)
          : await submitCargoRequestAuthed(payload);
      if (!result.ok) {
        setErrorCode(result.error);
        if (result.field_errors) setFieldErrors(result.field_errors);
        return;
      }
      setSuccess({
        cargo_request_id: result.cargo_request_id,
        cargo_request_number: result.cargo_request_number,
      });
    });
  };

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-8 text-center">
        <h2 className="font-ar text-2xl text-emerald-100">
          {cargoAr.submitSuccessTitle}
        </h2>
        <p className="font-ar mt-3 text-sm text-emerald-200">
          {cargoAr.submitSuccessMessage}
        </p>
        <p
          dir="ltr"
          className="font-mono mt-4 inline-block rounded-lg border border-emerald-400/50 bg-navy-card px-4 py-2 text-lg text-gold-light"
        >
          {success.cargo_request_number}
        </p>
        <p className="font-ar mt-6 text-sm text-ink-muted">
          {mode === 'guest' ? (
            <Link
              href="/login?redirect=/me/cargo-requests"
              className="text-gold-light hover:text-gold"
            >
              {cargoAr.submitSuccessLoginCta}
            </Link>
          ) : (
            <Link
              href={`/me/cargo-requests/${success.cargo_request_id}`}
              className="text-gold-light hover:text-gold"
            >
              {cargoAr.meDetailPageTitle} ←
            </Link>
          )}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-6 rounded-2xl border border-border bg-navy-card/40 p-6 sm:p-8"
    >
      {errorCode ? (
        <div
          role="alert"
          className="font-ar rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
        >
          {cargoErrorMessage(errorCode)}
        </div>
      ) : null}

      {/* 1. Cargo type selector */}
      <fieldset className="space-y-4">
        <legend className="font-ar mb-3 text-base font-medium text-ink-primary">
          {cargoAr.cargoTypeLabel}
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CARGO_TYPES.map((t) => (
            <label
              key={t}
              className={`font-ar relative block cursor-pointer rounded-xl border-2 p-5 transition-all ${
                cargoType === t
                  ? 'border-gold bg-gold/10 text-gold-light shadow-gold'
                  : 'border-border/60 bg-navy-secondary/40 text-ink hover:border-gold/40 hover:bg-navy-secondary/60'
              }`}
            >
              <input
                type="radio"
                name="cargo_type_radio"
                value={t}
                checked={cargoType === t}
                onChange={() => setCargoType(t)}
                className="sr-only"
              />
              <div className="text-base font-medium">
                {cargoAr.cargoTypes[t]}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                {cargoAr.cargoTypeDescriptions[t]}
              </p>
            </label>
          ))}
        </div>
      </fieldset>

      {/* 2. Customer fields — guest mode only. In authed mode the
          §4.2 RPC sources name/phone/email from the clients table
          at session.client_id (Phase 9 PR 2 immutable-snapshot
          discipline; the form must NOT let an authed user override
          their own identity per request). */}
      {mode === 'guest' ? (
        <fieldset className="space-y-4 border-t border-border/50 pt-6">
          <legend className="font-ar mb-3 text-base font-medium text-ink-primary">
            بيانات التواصل
          </legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label={cargoAr.customerNameLabel}
              name="customer_name"
              required
              error={fieldErrors.customer_name}
              maxLength={120}
            />
            <Field
              label={cargoAr.customerPhoneLabel}
              name="customer_phone"
              required
              dir="ltr"
              error={fieldErrors.customer_phone}
              maxLength={20}
            />
            <Field
              label={cargoAr.customerEmailLabel}
              name="customer_email"
              type="email"
              dir="ltr"
              error={fieldErrors.customer_email}
              maxLength={120}
            />
          </div>
        </fieldset>
      ) : null}

      {/* 3. Shared shipment fields */}
      <fieldset className="space-y-4 border-t border-border/50 pt-6">
        <legend className="font-ar mb-3 text-base font-medium text-ink-primary">
          تفاصيل الشحنة
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={cargoAr.originIataLabel}
          name="origin_iata"
          dir="ltr"
          maxLength={4}
          error={fieldErrors.origin_iata}
        />
        <Field
          label={cargoAr.originFreeformLabel}
          name="origin_freeform"
          error={fieldErrors.origin_freeform}
        />
        <Field
          label={cargoAr.destinationIataLabel}
          name="destination_iata"
          dir="ltr"
          maxLength={4}
          error={fieldErrors.destination_iata}
        />
        <Field
          label={cargoAr.destinationFreeformLabel}
          name="destination_freeform"
          error={fieldErrors.destination_freeform}
        />
        <Field
          label={cargoAr.pickupDateLabel}
          name="pickup_date"
          type="date"
          required
          error={fieldErrors.pickup_date}
        />
        <Field
          label={cargoAr.deliveryDateTargetLabel}
          name="delivery_date_target"
          type="date"
          error={fieldErrors.delivery_date_target}
        />
        <Field
          label={cargoAr.flexibilityDaysLabel}
          name="flexibility_days"
          type="number"
          min={0}
          max={7}
          defaultValue="0"
          error={fieldErrors.flexibility_days}
        />
        <Field
          label={cargoAr.estimatedValueLabel}
          name="estimated_value_sar"
          type="number"
          min={1}
          required
          dir="ltr"
          error={fieldErrors.estimated_value_sar}
        />
        </div>

        <div className="pt-2">
          <Toggle
            label={cargoAr.insuranceRequiredLabel}
            name="insurance_required"
          />
        </div>
      </fieldset>

      {/* 4. Per-category conditional fields */}
      <div className="border-t border-border/50 pt-6">
        <h3 className="font-ar mb-3 text-base font-medium text-ink-primary">
          تفاصيل {cargoAr.cargoTypes[cargoType] ?? cargoType}
        </h3>
        {cargoType === 'horse' && <HorseFields fieldErrors={fieldErrors} />}
        {cargoType === 'luxury_car' && (
          <LuxuryCarFields fieldErrors={fieldErrors} />
        )}
        {cargoType === 'valuables' && (
          <ValuablesFields fieldErrors={fieldErrors} />
        )}
        {cargoType === 'other' && <OtherFields fieldErrors={fieldErrors} />}
      </div>

      {/* 5. Notes (optional) */}
      <div className="border-t border-border/50 pt-6">
        <TextArea
          label={cargoAr.handlingNotesLabel}
          name="handling_notes"
          error={fieldErrors.handling_notes}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-ar text-xs text-ink-muted">
          سنتواصل معك خلال 24 ساعة بعروض من المشغّلين المعتمدين.
        </p>
        <button
          type="submit"
          disabled={isPending}
          className="font-ar inline-flex items-center justify-center rounded-lg border border-gold/50 bg-gold/15 px-6 py-3 text-base font-medium text-gold-light shadow-gold transition-all hover:border-gold hover:bg-gold/25 disabled:opacity-60"
        >
          {isPending ? cargoAr.submittingButton : cargoAr.submitButton}
        </button>
      </div>
    </form>
  );
}

// ============================================================
// Field primitives (lightweight; no shared library to keep
// PR 1 scope tight)
// ============================================================

interface FieldProps {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  dir?: 'ltr' | 'rtl';
  maxLength?: number;
  min?: number;
  max?: number;
  defaultValue?: string;
  error?: string;
}

function Field({
  label,
  name,
  type = 'text',
  required,
  dir,
  maxLength,
  min,
  max,
  defaultValue,
  error,
}: FieldProps) {
  return (
    <label className="font-ar block text-sm">
      <span className="mb-1.5 block text-ink-secondary">
        {label}
        {required ? (
          <span className="ms-1 text-gold-light" aria-hidden>
            *
          </span>
        ) : null}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        dir={dir}
        maxLength={maxLength}
        min={min}
        max={max}
        defaultValue={defaultValue}
        className="block w-full rounded-lg border border-border bg-navy-secondary/80 px-3.5 py-2.5 text-sm text-ink-primary shadow-sm transition-colors placeholder:text-ink-muted hover:border-border/80 focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/30"
      />
      {error ? (
        <p className="mt-1.5 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function TextArea({
  label,
  name,
  error,
}: {
  label: string;
  name: string;
  error?: string;
}) {
  return (
    <label className="font-ar block text-sm">
      <span className="mb-1.5 block text-ink-secondary">{label}</span>
      <textarea
        name={name}
        rows={3}
        className="block w-full rounded-lg border border-border bg-navy-secondary/80 px-3.5 py-2.5 text-sm text-ink-primary shadow-sm transition-colors placeholder:text-ink-muted hover:border-border/80 focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/30"
      />
      {error ? (
        <p className="mt-1.5 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

function Toggle({ label, name }: { label: string; name: string }) {
  return (
    <label className="font-ar flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        name={name}
        className="h-5 w-5 rounded border-border bg-navy-secondary text-gold accent-gold focus:ring-2 focus:ring-gold/40"
      />
      <span>{label}</span>
    </label>
  );
}

function Select({
  label,
  name,
  options,
  required,
  error,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  required?: boolean;
  error?: string;
}) {
  return (
    <label className="font-ar block text-sm">
      <span className="text-ink-muted">
        {label}
        {required ? <span className="ms-1 text-rose-300">*</span> : null}
      </span>
      <select
        name={name}
        required={required}
        className="mt-1 block w-full rounded-md border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none"
        defaultValue=""
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <p className="mt-1 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </label>
  );
}

// ============================================================
// Per-category field groups
// ============================================================

function HorseFields({ fieldErrors }: { fieldErrors: Record<string, string> }) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-border bg-navy-secondary/30 p-5">
      <legend className="font-ar px-2 text-sm font-medium text-gold-light">
        {cargoAr.cargoTypes.horse}
      </legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={cargoAr.horseCountLabel}
          name="horse_count"
          type="number"
          min={1}
          max={30}
          required
          error={fieldErrors.horse_count}
        />
        <Select
          label={cargoAr.horseCitesStatusLabel}
          name="horse_cites_status"
          options={Object.entries(cargoAr.horseCitesStatusOptions).map(
            ([value, label]) => ({ value, label })
          )}
          error={fieldErrors.horse_cites_status}
        />
      </div>
      <Toggle
        label={cargoAr.horseGroomRequiredLabel}
        name="horse_groom_required"
      />
      <TextArea
        label={cargoAr.horseStallRequirementsLabel}
        name="horse_stall_requirements"
        error={fieldErrors.horse_stall_requirements}
      />
    </fieldset>
  );
}

function LuxuryCarFields({
  fieldErrors,
}: {
  fieldErrors: Record<string, string>;
}) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-border bg-navy-secondary/30 p-5">
      <legend className="font-ar px-2 text-sm font-medium text-gold-light">
        {cargoAr.cargoTypes.luxury_car}
      </legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label={cargoAr.carMakeLabel}
          name="car_make"
          required
          error={fieldErrors.car_make}
        />
        <Field
          label={cargoAr.carModelLabel}
          name="car_model"
          required
          error={fieldErrors.car_model}
        />
        <Field
          label={cargoAr.carYearLabel}
          name="car_year"
          type="number"
          min={1900}
          max={2100}
          dir="ltr"
          error={fieldErrors.car_year}
        />
      </div>
      <Toggle
        label={cargoAr.carRunningConditionLabel}
        name="car_running_condition"
      />
      <Toggle
        label={cargoAr.carEnclosedRequiredLabel}
        name="car_enclosed_required"
      />
    </fieldset>
  );
}

function ValuablesFields({
  fieldErrors,
}: {
  fieldErrors: Record<string, string>;
}) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-border bg-navy-secondary/30 p-5">
      <legend className="font-ar px-2 text-sm font-medium text-gold-light">
        {cargoAr.cargoTypes.valuables}
      </legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={cargoAr.valuablesDeclaredValueLabel}
          name="valuables_declared_value_sar"
          type="number"
          min={1}
          required
          dir="ltr"
          error={fieldErrors.valuables_declared_value_sar}
        />
        <Select
          label={cargoAr.valuablesSecurityLevelLabel}
          name="valuables_security_level"
          options={Object.entries(cargoAr.valuablesSecurityLevelOptions).map(
            ([value, label]) => ({ value, label })
          )}
          error={fieldErrors.valuables_security_level}
        />
      </div>
      <Toggle
        label={cargoAr.valuablesClimateControlledLabel}
        name="valuables_climate_controlled"
      />
      <TextArea
        label={cargoAr.valuablesItemDescriptionLabel}
        name="valuables_item_description"
        error={fieldErrors.valuables_item_description}
      />
    </fieldset>
  );
}

function OtherFields({
  fieldErrors,
}: {
  fieldErrors: Record<string, string>;
}) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-border bg-navy-secondary/30 p-5">
      <legend className="font-ar px-2 text-sm font-medium text-gold-light">
        {cargoAr.cargoTypes.other}
      </legend>
      <TextArea
        label={cargoAr.otherDescriptionLabel}
        name="other_description"
        error={fieldErrors.other_description}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={cargoAr.otherDimensionsLabel}
          name="other_dimensions_lwh_cm"
          dir="ltr"
          error={fieldErrors.other_dimensions_lwh_cm}
        />
        <Field
          label={cargoAr.otherWeightLabel}
          name="other_weight_kg"
          type="number"
          min={0}
          dir="ltr"
          error={fieldErrors.other_weight_kg}
        />
      </div>
      <TextArea
        label={cargoAr.otherSpecialHandlingLabel}
        name="other_special_handling"
        error={fieldErrors.other_special_handling}
      />
    </fieldset>
  );
}

function cargoErrorMessage(code: string): string {
  return cargoAr.errors[code] ?? cargoAr.errors.server_error;
}
