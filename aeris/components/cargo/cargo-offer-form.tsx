'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { cargoAr } from '@/lib/i18n/cargo-ar';
import { submitCargoOffer } from '@/app/actions/cargo-operators';

/**
 * Phase 11 PR 2 — operator cargo offer form.
 *
 * Submits to submitCargoOffer Server Action which wraps §4.3
 * submit_cargo_offer RPC. The aircraft picker is server-side
 * filtered to capability-matched aircraft only (per
 * listCapableAircraftForOperator query).
 *
 * Field names match cargoOfferSchema exactly. Numeric inputs
 * are parsed inline so the Server Action receives Zod-friendly
 * types.
 */

interface AircraftOption {
  id: string;
  label: string;
}

interface CargoOfferFormProps {
  cargoRequestId: string;
  aircraftOptions: AircraftOption[];
  /** ISO date YYYY-MM-DD pre-filled in proposed_pickup_date */
  defaultPickupDate?: string;
  defaultDeliveryDate?: string;
}

function cargoErrorMessage(code: string): string {
  switch (code) {
    case 'aircraft_not_capable':
      return cargoAr.errorAircraftNotCapable;
    case 'operator_already_submitted':
      return cargoAr.errorOperatorAlreadySubmitted;
    case 'request_not_open':
      return cargoAr.errorRequestNotOpen;
    case 'request_expired':
      return cargoAr.errorRequestExpired;
    case 'must_change_password_first':
      return cargoAr.errorMustChangePassword;
    case 'flag_disabled':
      return cargoAr.errorFlagDisabled;
    case 'validation_failed':
      return cargoAr.errorValidation;
    case 'unauthorized':
      return cargoAr.errorUnauthorized;
    default:
      return cargoAr.errorServerError;
  }
}

export function CargoOfferForm({
  cargoRequestId,
  aircraftOptions,
  defaultPickupDate,
  defaultDeliveryDate,
}: CargoOfferFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (aircraftOptions.length === 0) {
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-6">
        <p className="font-ar text-sm text-amber-100">
          {cargoAr.operatorOfferAircraftEmpty}
        </p>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string): string | undefined => {
      const raw = fd.get(k);
      if (raw === null) return undefined;
      const s = String(raw).trim();
      return s.length > 0 ? s : undefined;
    };
    const num = (k: string): number | undefined => {
      const s = v(k);
      if (s === undefined) return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    };

    const payload = {
      cargo_request_id: cargoRequestId,
      aircraft_id: v('aircraft_id'),
      aircraft_snapshot: v('aircraft_snapshot'),
      base_price_sar: num('base_price_sar'),
      insurance_price_sar: num('insurance_price_sar') ?? 0,
      customs_handling_price_sar: num('customs_handling_price_sar') ?? 0,
      proposed_pickup_date: v('proposed_pickup_date'),
      proposed_delivery_date: v('proposed_delivery_date'),
      operator_notes: v('operator_notes'),
    };

    setErrorCode(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await submitCargoOffer(payload);
      if (!result.ok) {
        setErrorCode(result.error);
        if (result.field_errors) setFieldErrors(result.field_errors);
        return;
      }
      // Success → redirect to /operator/cargo/offers list
      router.push('/operator/cargo/offers');
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-2xl border border-border bg-navy-card/40 p-6 sm:p-8"
    >
      {errorCode ? (
        <div
          role="alert"
          className="font-ar rounded-lg border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
        >
          {cargoErrorMessage(errorCode)}
        </div>
      ) : null}

      <div>
        <label className="font-ar mb-1.5 block text-sm text-ink">
          {cargoAr.operatorOfferAircraftLabel} *
        </label>
        <select
          name="aircraft_id"
          required
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink"
        >
          <option value="">—</option>
          {aircraftOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        {fieldErrors.aircraft_id ? (
          <p className="font-ar mt-1 text-xs text-rose-200">
            {fieldErrors.aircraft_id}
          </p>
        ) : null}
      </div>

      <TextField
        label={cargoAr.operatorOfferAircraftSnapshotLabel}
        name="aircraft_snapshot"
        error={fieldErrors.aircraft_snapshot}
        maxLength={500}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField
          label={cargoAr.operatorOfferBasePriceLabel + ' *'}
          name="base_price_sar"
          type="number"
          required
          min={1}
          dir="ltr"
          error={fieldErrors.base_price_sar}
        />
        <TextField
          label={cargoAr.operatorOfferInsurancePriceLabel}
          name="insurance_price_sar"
          type="number"
          min={0}
          defaultValue="0"
          dir="ltr"
          error={fieldErrors.insurance_price_sar}
        />
        <TextField
          label={cargoAr.operatorOfferCustomsPriceLabel}
          name="customs_handling_price_sar"
          type="number"
          min={0}
          defaultValue="0"
          dir="ltr"
          error={fieldErrors.customs_handling_price_sar}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          label={cargoAr.operatorOfferProposedPickupLabel + ' *'}
          name="proposed_pickup_date"
          type="date"
          required
          defaultValue={defaultPickupDate}
          error={fieldErrors.proposed_pickup_date}
        />
        <TextField
          label={cargoAr.operatorOfferProposedDeliveryLabel + ' *'}
          name="proposed_delivery_date"
          type="date"
          required
          defaultValue={defaultDeliveryDate}
          error={fieldErrors.proposed_delivery_date}
        />
      </div>

      <div>
        <label className="font-ar mb-1.5 block text-sm text-ink">
          {cargoAr.operatorOfferNotesLabel}
        </label>
        <textarea
          name="operator_notes"
          rows={4}
          maxLength={1000}
          className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink"
        />
        {fieldErrors.operator_notes ? (
          <p className="font-ar mt-1 text-xs text-rose-200">
            {fieldErrors.operator_notes}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/50 bg-gold/15 px-6 py-3 text-base font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60 sm:w-auto"
      >
        {isPending
          ? cargoAr.operatorOfferSubmitting
          : cargoAr.operatorOfferSubmitCta}
      </button>
    </form>
  );
}

interface TextFieldProps {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  min?: number;
  maxLength?: number;
  dir?: 'ltr' | 'rtl';
  defaultValue?: string;
  error?: string;
}

function TextField({
  label,
  name,
  type = 'text',
  required,
  min,
  maxLength,
  dir,
  defaultValue,
  error,
}: TextFieldProps) {
  return (
    <div>
      <label className="font-ar mb-1.5 block text-sm text-ink">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        min={min}
        maxLength={maxLength}
        dir={dir}
        defaultValue={defaultValue}
        className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink"
      />
      {error ? (
        <p className="font-ar mt-1 text-xs text-rose-200">{error}</p>
      ) : null}
    </div>
  );
}
