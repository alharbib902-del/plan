'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';

import { clientsAr } from '@/lib/i18n/clients-ar';
import { createAuthenticatedTripRequest } from '@/app/actions/clients-trip-requests';
import { ClientBanner, clientErrorMessage } from './error-banner';

type AircraftPref =
  | 'light'
  | 'mid'
  | 'super_mid'
  | 'heavy'
  | 'long_range';

interface SuccessState {
  request_number: string;
}

export function ClientCharterForm() {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string>
  >({});
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const departureIata = String(fd.get('departure_iata') ?? '')
      .trim()
      .toUpperCase();
    const arrivalIata = String(fd.get('arrival_iata') ?? '')
      .trim()
      .toUpperCase();
    const departureDate = String(fd.get('departure_date') ?? '');
    const returnDateRaw = String(fd.get('return_date') ?? '');
    const returnDate = returnDateRaw.length > 0 ? returnDateRaw : null;
    const passengersRaw = String(fd.get('passengers') ?? '');
    const passengers = Number.parseInt(passengersRaw, 10);
    const aircraftPrefRaw = String(fd.get('aircraft_pref') ?? '');
    const aircraftPref =
      aircraftPrefRaw.length > 0
        ? (aircraftPrefRaw as AircraftPref)
        : null;
    const specialRequestsRaw = String(fd.get('special_requests') ?? '')
      .trim();
    const specialRequests =
      specialRequestsRaw.length > 0 ? specialRequestsRaw : null;

    // Build the legs array from the flat form fields. Outbound
    // leg is always the first entry; if a return date is set
    // we add the inverse leg as the second entry. The Server
    // Action persists this verbatim into trip_requests.legs.
    const legs: Array<{
      from: string;
      to: string;
      date: string;
      time: null;
    }> = [
      {
        from: departureIata,
        to: arrivalIata,
        date: departureDate,
        time: null,
      },
    ];
    if (returnDate) {
      legs.push({
        from: arrivalIata,
        to: departureIata,
        date: returnDate,
        time: null,
      });
    }

    setErrorCode(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createAuthenticatedTripRequest({
        legs,
        departure_iata: departureIata,
        arrival_iata: arrivalIata,
        departure_date: departureDate,
        return_date: returnDate,
        passengers,
        aircraft_pref: aircraftPref,
        special_requests: specialRequests,
      });
      if (!result.ok) {
        setErrorCode(result.error);
        if (result.field_errors) setFieldErrors(result.field_errors);
        return;
      }
      setSuccess({ request_number: result.request_number });
    });
  };

  if (success) {
    return (
      <div className="space-y-4">
        <ClientBanner kind="success">
          <p className="font-medium">{clientsAr.charterSuccessHeading}</p>
          <p className="mt-1 text-xs">
            {clientsAr.charterSuccessBody(success.request_number)}
          </p>
        </ClientBanner>
        <div className="text-center">
          <Link
            href="/me/requests"
            className="font-ar text-sm text-gold-light hover:text-gold"
          >
            {clientsAr.charterSuccessGoToRequests}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {errorCode ? (
        <ClientBanner kind="error">
          {clientErrorMessage(errorCode)}
        </ClientBanner>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="departure_iata"
          type="text"
          dir="ltr"
          label={clientsAr.charterDepartureIataLabel}
          maxLength={3}
          required
          uppercase
          error={fieldErrors.departure_iata}
        />
        <Field
          name="arrival_iata"
          type="text"
          dir="ltr"
          label={clientsAr.charterArrivalIataLabel}
          maxLength={3}
          required
          uppercase
          error={fieldErrors.arrival_iata}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="departure_date"
          type="datetime-local"
          dir="ltr"
          label={clientsAr.charterDepartureDateLabel}
          required
          error={fieldErrors.departure_date}
        />
        <Field
          name="return_date"
          type="datetime-local"
          dir="ltr"
          label={clientsAr.charterReturnDateLabel}
          error={fieldErrors.return_date}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="passengers"
          type="number"
          dir="ltr"
          label={clientsAr.charterPassengersLabel}
          min={1}
          max={19}
          required
          error={fieldErrors.passengers}
        />
        <SelectField
          name="aircraft_pref"
          label={clientsAr.charterAircraftPrefLabel}
          options={[
            { value: '', label: clientsAr.charterAircraftPrefAny },
            { value: 'light', label: clientsAr.charterAircraftPrefLight },
            { value: 'mid', label: clientsAr.charterAircraftPrefMid },
            {
              value: 'super_mid',
              label: clientsAr.charterAircraftPrefSuperMid,
            },
            { value: 'heavy', label: clientsAr.charterAircraftPrefHeavy },
            {
              value: 'long_range',
              label: clientsAr.charterAircraftPrefLongRange,
            },
          ]}
          error={fieldErrors.aircraft_pref}
        />
      </div>

      <TextareaField
        name="special_requests"
        label={clientsAr.charterSpecialRequestsLabel}
        rows={4}
        maxLength={2000}
        error={fieldErrors.special_requests}
      />

      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/40 bg-gold/15 px-4 py-3 text-sm font-medium text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-60"
      >
        {isPending
          ? clientsAr.charterSubmitting
          : clientsAr.charterSubmit}
      </button>
    </form>
  );
}

interface FieldProps {
  name: string;
  type: string;
  dir?: 'ltr' | 'rtl';
  label: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  uppercase?: boolean;
  error?: string;
}

function Field({
  name,
  type,
  dir,
  label,
  required,
  maxLength,
  min,
  max,
  uppercase,
  error,
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        dir={dir}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        className={`font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none ${uppercase ? 'uppercase' : ''}`}
      />
      {error ? (
        <p className="font-ar mt-1 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface SelectFieldProps {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  error?: string;
}

function SelectField({ name, label, options, error }: SelectFieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {label}
      </label>
      <select
        id={name}
        name={name}
        className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <p className="font-ar mt-1 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextareaFieldProps {
  name: string;
  label: string;
  rows?: number;
  maxLength?: number;
  error?: string;
}

function TextareaField({
  name,
  label,
  rows,
  maxLength,
  error,
}: TextareaFieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        maxLength={maxLength}
        className="font-ar w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink-primary focus:border-gold/50 focus:outline-none"
      />
      {error ? (
        <p className="font-ar mt-1 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
