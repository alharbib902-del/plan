'use client';

import { useState, useTransition } from 'react';
import { Loader2, Send } from 'lucide-react';

import { submitOperatorOffer } from '@/app/operator/offer/[token]/actions';
import {
  AIRCRAFT_CATEGORIES,
  type AircraftCategoryValue,
} from '@/lib/validators/promote-lead';
import { cn } from '@/lib/utils/cn';
import { AERIS_CONTACT } from '@/lib/config/contact';
import {
  aircraftCategoryLabel,
  formatRiyadhDateTime,
  type Lang,
  type StringKey,
  t,
} from '@/lib/i18n/operator';

type OfferSnapshot = {
  totalPriceSar: number;
  aircraftCategory: AircraftCategoryValue | null;
  aircraftType: string | null;
  departureEtaIso: string;
  validityHours: number;
};

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; snapshot: OfferSnapshot }
  | {
      kind: 'error';
      message: string;
      fieldErrors?: Record<string, string>;
    };

export function OperatorOfferForm({
  token,
  tripRequestNumber,
  lang,
  prefillCompanyName,
  prefillOperatorPhone,
  prefillOperatorEmail,
}: {
  token: string;
  tripRequestNumber: string;
  lang: Lang;
  prefillCompanyName: string | null;
  prefillOperatorPhone: string | null;
  prefillOperatorEmail: string | null;
}) {
  const [state, setState] = useState<SubmitState>({ kind: 'idle' });
  const [, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind === 'submitting') return;

    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
    formData.append('token', token);

    // Pre-build the snapshot from raw form values so we can show
    // it in SuccessPanel without re-querying. If submit fails
    // we discard the snapshot via the error state.
    const snapshot = readFormSnapshot(formEl);

    setState({ kind: 'submitting' });
    startTransition(async () => {
      const result = await submitOperatorOffer(formData);
      if (result.ok) {
        setState({ kind: 'success', snapshot });
        return;
      }
      setState({
        kind: 'error',
        message: translateError(result.error, lang),
        fieldErrors: result.field_errors,
      });
    });
  };

  if (state.kind === 'success') {
    return (
      <SuccessPanel
        snapshot={state.snapshot}
        tripRequestNumber={tripRequestNumber}
        lang={lang}
      />
    );
  }

  const submitting = state.kind === 'submitting';
  const fieldErrors = state.kind === 'error' ? state.fieldErrors : undefined;
  // Banner is shown ONLY for non-field errors (token_invalid /
  // target_not_pending / failed / etc., or invalid_input where
  // every field_errors key is unknown to the form). When at
  // least one inline message will render, the banner is
  // suppressed — the inline messages are the more specific
  // signal. Per spec acceptance #10 + Codex P2 patch.
  const hasResolvedFieldError =
    fieldErrors !== undefined &&
    Object.keys(fieldErrors).some(
      (field) => resolveFieldError(fieldErrors, field, lang) !== undefined
    );
  const showBanner = state.kind === 'error' && !hasResolvedFieldError;

  return (
    <form
      onSubmit={handleSubmit}
      lang={lang}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      className="space-y-5 rounded-xl border border-border bg-navy-card/40 p-6"
      noValidate
    >
      <div>
        <h3 className="font-ar text-lg text-ink">
          {t('submit_offer_heading', lang)}
        </h3>
        <p className="font-ar mt-1 text-xs text-ink-muted">
          {t('submit_offer_subtext', lang)}
        </p>
      </div>

      <Field
        label={t('field_operator_name', lang)}
        helper={t('helper_operator_name', lang)}
        error={resolveFieldError(fieldErrors, 'operator_name', lang)}
        required
      >
        <input
          type="text"
          name="operator_name"
          required
          maxLength={120}
          defaultValue={prefillCompanyName ?? ''}
          className={inputClass()}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('field_operator_phone', lang)}
          helper={t('helper_operator_phone', lang)}
          error={resolveFieldError(fieldErrors, 'operator_phone', lang)}
          required
        >
          <input
            type="tel"
            name="operator_phone"
            required
            placeholder="+966500000000"
            dir="ltr"
            defaultValue={prefillOperatorPhone ?? ''}
            className={inputClass()}
          />
        </Field>
        <Field
          label={t('field_operator_email', lang)}
          error={resolveFieldError(fieldErrors, 'operator_email', lang)}
        >
          <input
            type="email"
            name="operator_email"
            dir="ltr"
            defaultValue={prefillOperatorEmail ?? ''}
            className={inputClass()}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t('field_aircraft_category', lang)}
          error={resolveFieldError(fieldErrors, 'aircraft_category', lang)}
        >
          <select
            name="aircraft_category"
            defaultValue=""
            className={inputClass()}
          >
            <option value="" className="bg-navy">
              {t('select_choose_placeholder', lang)}
            </option>
            {AIRCRAFT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat} className="bg-navy">
                {aircraftCategoryLabel(cat, lang)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t('field_aircraft_type', lang)}
          error={resolveFieldError(fieldErrors, 'aircraft_type', lang)}
        >
          <input
            type="text"
            name="aircraft_type"
            placeholder="Gulfstream G650"
            maxLength={80}
            className={inputClass()}
          />
        </Field>
      </div>

      <Field
        label={t('field_aircraft_registration', lang)}
        error={resolveFieldError(fieldErrors, 'aircraft_registration', lang)}
      >
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
        <Field
          label={t('field_total_price', lang)}
          helper={t('helper_total_price', lang)}
          error={resolveFieldError(fieldErrors, 'total_price_sar', lang)}
          required
        >
          <input
            type="number"
            name="total_price_sar"
            required
            min={1000}
            step="any"
            className={inputClass()}
          />
        </Field>
        <Field
          label={t('field_departure_eta', lang)}
          helper={t('helper_departure_eta', lang)}
          error={resolveFieldError(fieldErrors, 'departure_eta', lang)}
          required
        >
          <input
            type="datetime-local"
            name="departure_eta"
            required
            className={inputClass()}
          />
        </Field>
      </div>

      <Field
        label={t('field_validity_hours', lang)}
        helper={t('helper_validity_hours', lang)}
        error={resolveFieldError(fieldErrors, 'validity_hours', lang)}
        required
      >
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

      <Field
        label={t('field_notes', lang)}
        error={resolveFieldError(fieldErrors, 'notes', lang)}
      >
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
        {t('submit_button', lang)}
      </button>

      {showBanner && state.kind === 'error' && (
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
  helper,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
        {required ? <span className="ms-1 text-red-300">*</span> : null}
      </span>
      <div className="mt-1">{children}</div>
      {helper && !error && (
        <p className="font-ar mt-1 text-[11px] leading-5 text-ink-muted">
          {helper}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="font-ar mt-1 text-[11px] leading-5 text-red-300"
        >
          {error}
        </p>
      )}
    </label>
  );
}

function inputClass() {
  return cn(
    'font-ar block w-full rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink',
    'placeholder:text-ink-muted hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40'
  );
}

function readFormSnapshot(formEl: HTMLFormElement): OfferSnapshot {
  const fd = new FormData(formEl);
  const priceRaw = fd.get('total_price_sar');
  const validityRaw = fd.get('validity_hours');
  const cat = fd.get('aircraft_category');
  const aircraftType = fd.get('aircraft_type');
  const departureEta = fd.get('departure_eta');

  const totalPriceSar = typeof priceRaw === 'string' ? Number(priceRaw) : 0;
  const validityHours =
    typeof validityRaw === 'string' ? Number(validityRaw) : 0;
  const aircraftCategory = isAircraftCategory(cat) ? cat : null;
  const aircraftTypeValue =
    typeof aircraftType === 'string' && aircraftType.trim().length > 0
      ? aircraftType.trim()
      : null;
  const departureEtaIso =
    typeof departureEta === 'string' && departureEta.length > 0
      ? toIsoOrEmpty(departureEta)
      : '';

  return {
    totalPriceSar,
    aircraftCategory,
    aircraftType: aircraftTypeValue,
    departureEtaIso,
    validityHours,
  };
}

function isAircraftCategory(value: FormDataEntryValue | null): value is AircraftCategoryValue {
  if (typeof value !== 'string') return false;
  return (AIRCRAFT_CATEGORIES as readonly string[]).includes(value);
}

function toIsoOrEmpty(localDateTime: string): string {
  const d = new Date(localDateTime);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function SuccessPanel({
  snapshot,
  tripRequestNumber,
  lang,
}: {
  snapshot: OfferSnapshot;
  tripRequestNumber: string;
  lang: Lang;
}) {
  const founderWaUrl = `https://wa.me/${AERIS_CONTACT.whatsappNumber}`;
  const aircraftLabel = formatAircraftEcho(snapshot, lang);
  const formattedPrice = new Intl.NumberFormat(
    lang === 'en' ? 'en-US' : 'ar-SA',
    { maximumFractionDigits: 0, useGrouping: true, numberingSystem: 'latn' }
  ).format(snapshot.totalPriceSar);

  return (
    <div
      lang={lang}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      className="rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-8"
    >
      <h3 className="font-ar text-xl text-emerald-200 text-center">
        {t('success_title', lang)}
      </h3>
      <p className="font-ar mt-3 text-center text-sm leading-7 text-emerald-100/80">
        {t('success_body', lang)}
      </p>

      <div className="mt-6 rounded-xl border border-emerald-400/20 bg-navy-card/40 p-5">
        <h4 className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
          {t('success_summary_heading', lang)}
        </h4>
        <dl className="mt-3 space-y-2">
          <SummaryRow
            label={t('success_field_request_number', lang)}
            value={<span className="font-mono">{tripRequestNumber}</span>}
          />
          <SummaryRow
            label={t('success_field_price', lang)}
            value={
              <>
                {formattedPrice}{' '}
                <span className="text-ink-muted">{t('sar_unit', lang)}</span>
              </>
            }
          />
          {aircraftLabel && (
            <SummaryRow
              label={t('success_field_aircraft', lang)}
              value={aircraftLabel}
            />
          )}
          {snapshot.departureEtaIso && (
            <SummaryRow
              label={t('success_field_departure', lang)}
              value={formatRiyadhDateTime(snapshot.departureEtaIso, lang)}
            />
          )}
          <SummaryRow
            label={t('success_field_validity', lang)}
            value={
              <>
                {snapshot.validityHours}{' '}
                <span className="text-ink-muted">
                  {t('success_validity_hours_unit', lang)}
                </span>
              </>
            }
          />
        </dl>
      </div>

      <p className="font-ar mt-4 text-center text-[11px] text-emerald-100/60">
        {t('success_save_reference_note', lang)}
      </p>

      <div className="mt-5 text-center">
        <a
          href={founderWaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-ar inline-flex items-center justify-center rounded-md border border-gold/40 bg-gold/10 px-5 py-2 text-sm text-gold-light hover:border-gold hover:bg-gold/20"
        >
          {t('whatsapp_contact_button', lang)}
        </a>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px,1fr] gap-3 sm:grid-cols-[140px,1fr]">
      <dt className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </dt>
      <dd className="font-ar text-sm text-ink">{value}</dd>
    </div>
  );
}

function formatAircraftEcho(snapshot: OfferSnapshot, lang: Lang): string | null {
  const parts: string[] = [];
  if (snapshot.aircraftCategory) {
    parts.push(aircraftCategoryLabel(snapshot.aircraftCategory, lang));
  }
  if (snapshot.aircraftType) {
    parts.push(snapshot.aircraftType);
  }
  return parts.length > 0 ? parts.join(' — ') : null;
}

function translateError(
  code:
    | 'invalid_input'
    | 'token_invalid'
    | 'failed'
    | 'trip_not_found'
    | 'trip_closed'
    | 'token_stale'
    | 'invalid_offer'
    | 'target_not_pending'
    | 'trip_not_open',
  lang: Lang
): string {
  switch (code) {
    case 'invalid_input':
    case 'invalid_offer':
      return t('error_invalid_input_block', lang);
    case 'target_not_pending':
      return t('error_target_not_pending', lang);
    case 'trip_not_open':
    case 'trip_closed':
      return t('error_trip_not_open', lang);
    case 'token_invalid':
    case 'trip_not_found':
    case 'token_stale':
      return t('error_token_invalid_or_stale', lang);
    case 'failed':
    default:
      return t('error_failed', lang);
  }
}

function resolveFieldError(
  fieldErrors: Record<string, string> | undefined,
  fieldName: string,
  lang: Lang
): string | undefined {
  const code = fieldErrors?.[fieldName];
  if (!code) return undefined;
  // Server returns translation keys; only render if the key is
  // one we know about. Unknown keys (forward-compat from a future
  // validator change without dict update) fall back silently to
  // the block-level error.
  if (!isKnownStringKey(code)) return undefined;
  return t(code, lang);
}

const KNOWN_ZOD_KEYS = new Set<string>([
  'zod_operator_name_required',
  'zod_operator_name_too_long',
  'zod_operator_phone_invalid',
  'zod_operator_email_too_long',
  'zod_operator_email_invalid',
  'zod_aircraft_category_invalid',
  'zod_aircraft_type_too_long',
  'zod_aircraft_registration_too_long',
  'zod_total_price_required',
  'zod_total_price_invalid',
  'zod_total_price_too_low',
  'zod_total_price_too_high',
  'zod_departure_eta_required',
  'zod_departure_eta_invalid',
  'zod_validity_hours_invalid',
  'zod_validity_hours_too_low',
  'zod_validity_hours_too_high',
  'zod_notes_too_long',
]);

function isKnownStringKey(value: string): value is StringKey {
  return KNOWN_ZOD_KEYS.has(value);
}
