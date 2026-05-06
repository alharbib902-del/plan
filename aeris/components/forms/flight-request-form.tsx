'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { whatsappLink } from '@/lib/utils/format';
import { AERIS_DEFAULT_WHATSAPP_MESSAGE } from '@/lib/config/contact';
import {
  submitFlightRequest,
  type FlightRequestActionResult,
} from '@/app/actions/flight-request';
import { AirportCombobox } from '@/components/ui/airport-combobox';
import type { AirportRow } from '@/types/database';

const ERROR_MESSAGES_AR: Record<string, string> = {
  // Phase 6.0 PR 2 (S3): airport picker error codes.
  origin_required: 'اختر مطاراً أو اكتب يدوياً.',
  origin_ambiguous: 'اختر إما من القائمة أو اكتب يدوياً، ليس الاثنين.',
  origin_iata_invalid: 'رمز المطار غير صحيح.',
  origin_iata_unknown: 'هذا الرمز غير معروف. اختر من القائمة أو اكتب يدوياً.',
  origin_freeform_too_short: 'الاسم قصير جداً.',
  origin_freeform_too_long: 'الاسم طويل جداً.',
  destination_required: 'اختر مطاراً أو اكتب يدوياً.',
  destination_ambiguous: 'اختر إما من القائمة أو اكتب يدوياً، ليس الاثنين.',
  destination_iata_invalid: 'رمز المطار غير صحيح.',
  destination_iata_unknown:
    'هذا الرمز غير معروف. اختر من القائمة أو اكتب يدوياً.',
  destination_freeform_too_short: 'الاسم قصير جداً.',
  destination_freeform_too_long: 'الاسم طويل جداً.',
  // Pre-existing codes (unchanged).
  departure_required: 'من فضلك اختر تاريخ المغادرة.',
  departure_invalid: 'تاريخ المغادرة غير صالح.',
  departure_in_past: 'تاريخ المغادرة لا يمكن أن يكون في الماضي.',
  return_invalid: 'تاريخ العودة غير صالح.',
  return_before_departure: 'تاريخ العودة يجب أن يكون بعد تاريخ المغادرة.',
  passengers_invalid: 'عدد الركاب غير صالح.',
  passengers_min: 'عدد الركاب يجب أن يكون 1 على الأقل.',
  passengers_max: 'الحد الأقصى لعدد الركاب 19 راكباً.',
  trip_type_required: 'من فضلك اختر نوع الرحلة.',
  trip_type_invalid: 'نوع الرحلة غير صالح.',
  name_required: 'من فضلك أدخل اسمك.',
  name_too_short: 'الاسم قصير جداً.',
  name_too_long: 'الاسم طويل جداً.',
  phone_required: 'من فضلك أدخل رقم هاتفك.',
  phone_too_short: 'رقم الهاتف قصير جداً.',
  phone_too_long: 'رقم الهاتف طويل جداً.',
  phone_invalid: 'رقم الهاتف غير صالح. استخدم أرقاماً وعلامة + إن لزم.',
  notes_too_long: 'الملاحظات طويلة جداً.',
};

function translateError(code: string): string {
  return ERROR_MESSAGES_AR[code] ?? 'قيمة غير صالحة.';
}

const TRIP_TYPE_OPTIONS = [
  { value: 'one_way', label: 'ذهاب فقط' },
  { value: 'round_trip', label: 'ذهاب وعودة' },
  { value: 'multi_city', label: 'متعدد الوجهات' },
] as const;

const todayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const fieldLabel = 'font-ar mb-2 block text-sm text-ink';
const fieldInput =
  'font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink placeholder:text-ink-muted/70 transition-colors hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60';
const fieldError = 'font-ar mt-1.5 text-xs text-red-400';

export function FlightRequestForm({
  airports,
}: {
  airports: AirportRow[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{
    requestNumber: string | null;
    whatsappUrl: string;
    persisted: boolean;
  } | null>(null);
  const [tripType, setTripType] = useState<(typeof TRIP_TYPE_OPTIONS)[number]['value']>('one_way');

  const minDate = useMemo(() => todayIso(), []);

  useEffect(() => {
    if (success) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [success]);

  if (success) {
    return (
      <SuccessPanel
        requestNumber={success.requestNumber}
        whatsappUrl={success.whatsappUrl}
        persisted={success.persisted}
        onReset={() => {
          setSuccess(null);
          setErrors({});
          formRef.current?.reset();
          setTripType('one_way');
        }}
      />
    );
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setErrors({});

    startTransition(async () => {
      let result: FlightRequestActionResult;
      try {
        result = await submitFlightRequest(formData);
      } catch (err) {
        console.error('[flight-request-form] submit failed', err);
        setErrors({ form: 'تعذّر إرسال الطلب. حاول مرة أخرى أو تواصل عبر واتساب.' });
        return;
      }

      if (!result.ok) {
        const translated: Record<string, string> = {};
        for (const [key, code] of Object.entries(result.fieldErrors)) {
          translated[key] = translateError(code);
        }
        if (result.formError) {
          translated.form = translateError(result.formError);
        }
        setErrors(translated);
        return;
      }

      setSuccess({
        requestNumber: result.requestNumber,
        whatsappUrl: result.whatsappUrl,
        persisted: result.persisted,
      });
    });
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="grid gap-6 rounded-2xl border border-border bg-navy-card/40 p-6 shadow-luxury sm:p-8"
    >
      {/* Honeypot — visually hidden, not announced to assistive tech. Bots fill all fields, humans don't. */}
      <div aria-hidden="true" className="hidden">
        <label>
          Company
          <input
            type="text"
            name="hp_company"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </label>
      </div>

      <fieldset className="grid gap-6 sm:grid-cols-2" disabled={pending}>
        <AirportCombobox
          name="origin"
          airports={airports}
          label="من (المطار)"
          placeholder="اختر مطار المغادرة…"
          required
          error={errors.origin}
        />
        <AirportCombobox
          name="destination"
          airports={airports}
          label="إلى (المطار)"
          placeholder="اختر مطار الوصول…"
          required
          error={errors.destination}
        />
      </fieldset>

      <fieldset disabled={pending}>
        <span className={fieldLabel}>نوع الرحلة</span>
        <div
          role="radiogroup"
          aria-label="نوع الرحلة"
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {TRIP_TYPE_OPTIONS.map((option) => {
            const active = tripType === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  'font-ar relative flex cursor-pointer items-center justify-center rounded-md border px-4 py-3 text-sm transition-colors',
                  active
                    ? 'border-gold bg-gold/10 text-gold-light'
                    : 'border-border bg-navy-secondary/60 text-ink-secondary hover:border-gold/40'
                )}
              >
                <input
                  type="radio"
                  name="tripType"
                  value={option.value}
                  checked={active}
                  onChange={() => setTripType(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
        {errors.tripType && <p className={fieldError}>{errors.tripType}</p>}
      </fieldset>

      <fieldset className="grid gap-6 sm:grid-cols-2" disabled={pending}>
        <Field
          name="departureDate"
          type="date"
          label="تاريخ المغادرة"
          min={minDate}
          error={errors.departureDate}
          required
        />
        <Field
          name="returnDate"
          type="date"
          label={
            tripType === 'round_trip'
              ? 'تاريخ العودة'
              : 'تاريخ العودة (اختياري)'
          }
          min={minDate}
          error={errors.returnDate}
          required={tripType === 'round_trip'}
        />
      </fieldset>

      <fieldset className="grid gap-6 sm:grid-cols-2" disabled={pending}>
        <Field
          name="passengers"
          type="number"
          label="عدد الركاب"
          min={1}
          max={19}
          defaultValue={2}
          inputMode="numeric"
          error={errors.passengers}
          required
        />
        <Field
          name="customerName"
          label="الاسم الكامل"
          placeholder="مثال: محمد العتيبي"
          autoComplete="name"
          error={errors.customerName}
          required
        />
      </fieldset>

      <fieldset className="grid gap-6" disabled={pending}>
        <Field
          name="customerPhone"
          type="tel"
          label="رقم الهاتف (يُفضّل واتساب)"
          placeholder="+966 5X XXX XXXX"
          autoComplete="tel"
          dir="ltr"
          error={errors.customerPhone}
          required
        />

        <div>
          <label className={fieldLabel} htmlFor="notes">
            ملاحظات إضافية (اختياري)
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            maxLength={1000}
            placeholder="أي تفضيلات: نوع الطائرة، خدمات الضيافة، نقل أرضي..."
            className={fieldInput}
          />
          {errors.notes && <p className={fieldError}>{errors.notes}</p>}
        </div>
      </fieldset>

      {errors.form && (
        <p className="font-ar rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {errors.form}
        </p>
      )}

      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-ar text-xs leading-6 text-ink-muted">
          الخطوة الأخيرة بعد الإرسال: إرسال الطلب مباشرة إلى فريق Aeris عبر
          واتساب.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="font-ar group inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-8 py-4 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              جاري الإرسال...
            </>
          ) : (
            <>
              إرسال الطلب
              <ArrowLeft
                className="h-4 w-4 transition-transform group-hover:-translate-x-1 rtl:rotate-180"
                aria-hidden
              />
            </>
          )}
        </button>
      </div>
    </form>
  );
}

type FieldProps = {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  defaultValue?: string | number;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
  dir?: 'ltr' | 'rtl';
  error?: string;
};

function Field({
  name,
  label,
  type = 'text',
  placeholder,
  required,
  min,
  max,
  defaultValue,
  autoComplete,
  inputMode,
  dir,
  error,
}: FieldProps) {
  const id = `f-${name}`;
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
        {required && <span className="text-gold"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        dir={dir}
        min={min}
        max={max}
        defaultValue={defaultValue}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(fieldInput, error && 'border-red-400/60')}
      />
      {error && (
        <p id={`${id}-error`} className={fieldError}>
          {error}
        </p>
      )}
    </div>
  );
}

function SuccessPanel({
  requestNumber,
  whatsappUrl,
  persisted,
  onReset,
}: {
  requestNumber: string | null;
  whatsappUrl: string;
  persisted: boolean;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gold/30 bg-navy-card/60 p-8 text-center shadow-luxury sm:p-12">
      <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold">
        <CheckCircle2 className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="font-ar text-2xl text-ink sm:text-3xl">
        {persisted ? 'استلمنا طلبك بنجاح' : 'تم تجهيز طلبك'}
      </h3>

      {requestNumber && (
        <p className="font-ar mx-auto mt-3 max-w-xl text-sm leading-7 text-ink-secondary sm:text-base">
          رقم طلبك المرجعي:{' '}
          <span className="font-mono text-gold-light">{requestNumber}</span>
        </p>
      )}

      <p className="font-ar mx-auto mt-3 max-w-xl text-sm leading-7 text-ink-secondary sm:text-base">
        {persisted
          ? 'سيتواصل معك فريق Aeris قريباً. لتسريع الرد، أرسل التفاصيل مباشرة عبر واتساب.'
          : 'اضغط "متابعة عبر واتساب" لإرساله مباشرة إلى فريق Aeris وتسريع الرد.'}
      </p>

      {!persisted && (
        <p className="font-ar mx-auto mt-4 max-w-xl text-xs text-ink-muted">
          واتساب هو القناة التشغيلية الرسمية لـ Aeris حالياً — لذلك إرسال
          الطلب عبر واتساب هو الخطوة الأخيرة لوصوله إلى الفريق.
        </p>
      )}

      <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        <Link
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-ar inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-8 py-4 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow"
        >
          متابعة عبر واتساب
        </Link>
        <button
          type="button"
          onClick={onReset}
          className="font-ar inline-flex items-center justify-center gap-2 rounded-md border border-gold/30 px-8 py-4 text-base text-gold-light transition-all hover:border-gold hover:bg-gold/10"
        >
          إرسال طلب آخر
        </button>
      </div>

      <div className="mt-8">
        <Link
          href={whatsappLink(AERIS_DEFAULT_WHATSAPP_MESSAGE)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-ar text-xs text-ink-muted underline-offset-4 hover:text-gold hover:underline"
        >
          أو تواصل معنا في موضوع آخر عبر واتساب
        </Link>
      </div>
    </div>
  );
}
