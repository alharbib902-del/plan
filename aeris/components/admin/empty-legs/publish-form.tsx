'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { adminPublishEmptyLeg } from '@/app/actions/empty-legs';
import { emptyLegsAr } from '@/lib/i18n/empty-legs-ar';
import { translateEmptyLegError } from './error-translator';
import { datetimeLocalToRiyadhIso } from './formatters';

interface FormState {
  error: string | null;
  fieldErrors: Record<string, string>;
}

const INITIAL: FormState = { error: null, fieldErrors: {} };

function readString(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readNumber(form: FormData, key: string): number | null {
  const raw = readString(form, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function PublishEmptyLegForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<FormState>(INITIAL);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState(INITIAL);

    const form = new FormData(e.currentTarget);
    const original = readNumber(form, 'original_price');
    const maxPax = readNumber(form, 'max_passengers');
    const start = readString(form, 'departure_window_start');
    const end = readString(form, 'departure_window_end');

    if (original === null || maxPax === null || !start || !end) {
      setState({
        error: emptyLegsAr.errorGeneric,
        fieldErrors: {
          ...(original === null
            ? { original_price: 'original_price_invalid' }
            : {}),
          ...(maxPax === null
            ? { max_passengers: 'max_passengers_invalid' }
            : {}),
          ...(!start
            ? { departure_window_start: 'datetime_required' }
            : {}),
          ...(!end ? { departure_window_end: 'datetime_required' } : {}),
        },
      });
      return;
    }

    const auctionCurveRaw = readString(form, 'auction_curve');
    const auctionCurve =
      auctionCurveRaw === 'linear' || auctionCurveRaw === 'accelerating'
        ? auctionCurveRaw
        : null;

    startTransition(async () => {
      const result = await adminPublishEmptyLeg({
        operator_name: readString(form, 'operator_name'),
        operator_phone: readString(form, 'operator_phone'),
        operator_email: readString(form, 'operator_email'),
        aircraft_text: readString(form, 'aircraft_text'),
        departure_airport_iata: readString(form, 'departure_airport_iata'),
        departure_airport_freeform: readString(
          form,
          'departure_airport_freeform'
        ),
        arrival_airport_iata: readString(form, 'arrival_airport_iata'),
        arrival_airport_freeform: readString(
          form,
          'arrival_airport_freeform'
        ),
        departure_window_start: datetimeLocalToRiyadhIso(start),
        departure_window_end: datetimeLocalToRiyadhIso(end),
        flexibility_hours: readNumber(form, 'flexibility_hours'),
        original_price: original,
        max_passengers: maxPax,
        auction_initial_discount_pct: readNumber(
          form,
          'auction_initial_discount_pct'
        ),
        auction_floor_discount_pct: readNumber(
          form,
          'auction_floor_discount_pct'
        ),
        auction_curve: auctionCurve,
        auction_window_lead_hours: readNumber(
          form,
          'auction_window_lead_hours'
        ),
        suppress_notifications: form.get('suppress_notifications') === 'on',
      });

      if (result.ok) {
        router.push(`/admin/empty-legs/${result.leg_id}`);
        router.refresh();
        return;
      }
      setState({
        error: translateEmptyLegError(result.error),
        fieldErrors: result.field_errors ?? {},
      });
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <p className="font-ar text-sm text-ink-muted">
        {emptyLegsAr.formPublishSubtitle}
      </p>

      <Section title="">
        <Field label={emptyLegsAr.fieldOperatorName} name="operator_name">
          <input
            id="operator_name"
            name="operator_name"
            type="text"
            className={inputCls}
          />
        </Field>
        <Field label={emptyLegsAr.fieldOperatorPhone} name="operator_phone">
          <input
            id="operator_phone"
            name="operator_phone"
            type="tel"
            dir="ltr"
            className={inputCls}
          />
        </Field>
        <Field label={emptyLegsAr.fieldOperatorEmail} name="operator_email">
          <input
            id="operator_email"
            name="operator_email"
            type="email"
            dir="ltr"
            className={inputCls}
          />
        </Field>
        <Field label={emptyLegsAr.fieldAircraftText} name="aircraft_text">
          <input
            id="aircraft_text"
            name="aircraft_text"
            type="text"
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="">
        <p className="font-ar md:col-span-2 text-xs text-ink-muted">
          {emptyLegsAr.formPublishHintRoutePresence}
        </p>
        <Field
          label={emptyLegsAr.fieldDepartureAirportIata}
          name="departure_airport_iata"
          error={state.fieldErrors.departure_airport_iata}
        >
          <input
            id="departure_airport_iata"
            name="departure_airport_iata"
            type="text"
            maxLength={3}
            dir="ltr"
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.fieldDepartureAirportFreeform}
          name="departure_airport_freeform"
        >
          <input
            id="departure_airport_freeform"
            name="departure_airport_freeform"
            type="text"
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.fieldArrivalAirportIata}
          name="arrival_airport_iata"
          error={state.fieldErrors.arrival_airport_iata}
        >
          <input
            id="arrival_airport_iata"
            name="arrival_airport_iata"
            type="text"
            maxLength={3}
            dir="ltr"
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.fieldArrivalAirportFreeform}
          name="arrival_airport_freeform"
        >
          <input
            id="arrival_airport_freeform"
            name="arrival_airport_freeform"
            type="text"
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="">
        <Field
          label={emptyLegsAr.fieldDepartureWindowStart}
          name="departure_window_start"
          error={state.fieldErrors.departure_window_start}
        >
          <input
            id="departure_window_start"
            name="departure_window_start"
            type="datetime-local"
            required
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.fieldDepartureWindowEnd}
          name="departure_window_end"
          error={state.fieldErrors.departure_window_end}
        >
          <input
            id="departure_window_end"
            name="departure_window_end"
            type="datetime-local"
            required
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.fieldFlexibilityHours}
          name="flexibility_hours"
        >
          <input
            id="flexibility_hours"
            name="flexibility_hours"
            type="number"
            min={0}
            max={48}
            className={inputCls}
            placeholder="3"
          />
        </Field>
      </Section>

      <Section title="">
        <Field
          label={emptyLegsAr.fieldOriginalPrice}
          name="original_price"
          error={state.fieldErrors.original_price}
        >
          <input
            id="original_price"
            name="original_price"
            type="number"
            min={1}
            step="0.01"
            required
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.fieldMaxPassengers}
          name="max_passengers"
          error={state.fieldErrors.max_passengers}
        >
          <input
            id="max_passengers"
            name="max_passengers"
            type="number"
            min={1}
            max={19}
            required
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="">
        <Field
          label={emptyLegsAr.fieldAuctionInitialPct}
          name="auction_initial_discount_pct"
          error={state.fieldErrors.auction_initial_discount_pct}
        >
          <input
            id="auction_initial_discount_pct"
            name="auction_initial_discount_pct"
            type="number"
            min={10}
            max={50}
            step="0.5"
            placeholder="40"
            className={inputCls}
          />
        </Field>
        <Field
          label={emptyLegsAr.fieldAuctionFloorPct}
          name="auction_floor_discount_pct"
          error={state.fieldErrors.auction_floor_discount_pct}
        >
          <input
            id="auction_floor_discount_pct"
            name="auction_floor_discount_pct"
            type="number"
            min={50}
            max={90}
            step="0.5"
            placeholder="70"
            className={inputCls}
          />
        </Field>
        <Field label={emptyLegsAr.fieldAuctionCurve} name="auction_curve">
          <select
            id="auction_curve"
            name="auction_curve"
            defaultValue="accelerating"
            className={inputCls}
          >
            <option value="accelerating">
              {emptyLegsAr.fieldAuctionCurveAccelerating}
            </option>
            <option value="linear">
              {emptyLegsAr.fieldAuctionCurveLinear}
            </option>
          </select>
        </Field>
        <Field
          label={emptyLegsAr.fieldAuctionLeadHours}
          name="auction_window_lead_hours"
        >
          <input
            id="auction_window_lead_hours"
            name="auction_window_lead_hours"
            type="number"
            min={0}
            max={168}
            placeholder="6"
            className={inputCls}
          />
        </Field>
      </Section>

      <div className="rounded-lg border border-border bg-navy-secondary/40 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="suppress_notifications"
            className="mt-1"
          />
          <span>
            <span className="font-ar block text-sm text-ink">
              {emptyLegsAr.fieldSuppressNotifications}
            </span>
            <span className="font-ar mt-1 block text-xs text-ink-muted">
              {emptyLegsAr.fieldSuppressNotificationsHint}
            </span>
          </span>
        </label>
      </div>

      {state.error ? (
        <div
          role="alert"
          className="font-ar rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {state.error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-gold bg-gold/10 px-5 py-2 text-sm text-gold-light transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending
            ? emptyLegsAr.formSubmitting
            : emptyLegsAr.formSubmitPublish}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'font-ar block w-full rounded-md border border-border bg-navy-card/60 px-3 py-2 text-sm text-ink shadow-sm focus:border-gold/60 focus:outline-none';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-navy-secondary/30 p-4">
      {title ? (
        <h3 className="font-ar mb-4 text-sm uppercase tracking-tagged text-ink-muted">
          {title}
        </h3>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="font-ar mb-1 block text-xs text-ink-muted"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p
          className="font-ar mt-1 text-xs text-red-300"
          role="alert"
        >
          {translateEmptyLegError(error)}
        </p>
      ) : null}
    </div>
  );
}
