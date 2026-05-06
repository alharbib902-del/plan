'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils/cn';
import type { TripPreferences } from '@/lib/validators/trip-preferences';

/**
 * Phase 6.1 PR 2 — shared preferences fields, used by both
 * `/request` (customer-facing, wrapped in a collapsible
 * <details>) and admin promote-lead-form (founder-facing,
 * always expanded). The shared piece is the 9 input fields;
 * each parent form owns its own wrapper UX.
 *
 * Discovery / architectural note: this file is NOT in the
 * Phase 6.1 spec iteration 4 "Files likely touched" list —
 * the spec describes both forms as gaining "the same
 * preference fields" but doesn't extract a shared
 * component. Inlining would duplicate ~150 lines of UI
 * across two files (including the tri-state halal logic,
 * the ISO 3166 / ISO 639 picker lists, and the canonical
 * key-omission serialization). Same precedent as Phase 5.1
 * PR 2's `OperatorPortalHeader` discovery (an out-of-fence
 * file that the spec implied but didn't name). Codex
 * review can fold this back into one of the parent forms
 * if the discovery is rejected.
 *
 * The component is **stateless** — it takes `value` and
 * `onChange` from the parent. The parent owns state, owns
 * serialization-to-JSON on submit, and owns collapsible vs.
 * always-expanded chrome.
 *
 * Canonical storage rule (from
 * lib/validators/trip-preferences.ts):
 *   - No preference expressed = key OMITTED from the JSONB.
 *   - For booleans: `true` / `false` are explicit choices,
 *     key absent = no preference. The halal tri-state
 *     radio group enforces this UX-side; non-tri-state
 *     boolean checkboxes (prayer_setup, elderly_assistance)
 *     map unchecked → key absent and checked → true.
 *   - For arrays: empty arrays are stripped on serialize.
 *   - For child_seats: 0 forbidden — key omission is the
 *     only "no preference" signal.
 */

// Curated KSA-market list of countries + GCC + common
// crew-supplier nations. Per Phase 6.1 spec iteration 4
// Q3 (my read): hard-coded for 6.1; matching engine
// doesn't exist yet, no real crew_members data to query.
// Codex iteration 1 review of PR 2 will likely tune this
// list.
type CountryOption = { code: string; ar: string; en: string };
const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'SA', ar: 'السعودية', en: 'Saudi Arabia' },
  { code: 'AE', ar: 'الإمارات', en: 'United Arab Emirates' },
  { code: 'KW', ar: 'الكويت', en: 'Kuwait' },
  { code: 'QA', ar: 'قطر', en: 'Qatar' },
  { code: 'BH', ar: 'البحرين', en: 'Bahrain' },
  { code: 'OM', ar: 'عُمان', en: 'Oman' },
  { code: 'EG', ar: 'مصر', en: 'Egypt' },
  { code: 'JO', ar: 'الأردن', en: 'Jordan' },
  { code: 'LB', ar: 'لبنان', en: 'Lebanon' },
  { code: 'SY', ar: 'سوريا', en: 'Syria' },
  { code: 'IQ', ar: 'العراق', en: 'Iraq' },
  { code: 'YE', ar: 'اليمن', en: 'Yemen' },
  { code: 'SD', ar: 'السودان', en: 'Sudan' },
  { code: 'PK', ar: 'باكستان', en: 'Pakistan' },
  { code: 'IN', ar: 'الهند', en: 'India' },
  { code: 'PH', ar: 'الفلبين', en: 'Philippines' },
];

type LanguageOption = { code: string; ar: string };
const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'ar', ar: 'العربية' },
  { code: 'en', ar: 'الإنجليزية' },
  { code: 'ur', ar: 'الأردية' },
  { code: 'fr', ar: 'الفرنسية' },
  { code: 'hi', ar: 'الهندية' },
];

const fieldLabel = 'font-ar mb-2 block text-sm text-ink';
const fieldHint = 'font-ar mt-1 block text-xs text-ink-muted';
const fieldInput =
  'font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink placeholder:text-ink-muted/70 transition-colors hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60';

export interface TripPreferencesFieldsProps {
  value: TripPreferences;
  onChange: (next: TripPreferences) => void;
  disabled?: boolean;
}

export function TripPreferencesFields({
  value,
  onChange,
  disabled,
}: TripPreferencesFieldsProps) {
  // The setter helpers below all produce a new object
  // without mutating `value`. They DO NOT auto-strip
  // null/undefined/empty — that's the parent's job at
  // submit time via mergeTripPreferences. Mid-edit state
  // can carry transient empty values without breaking the
  // typed shape.
  const set = <K extends keyof TripPreferences>(
    key: K,
    next: TripPreferences[K] | undefined
  ) => {
    const copy = { ...value };
    if (next === undefined) {
      delete copy[key];
    } else {
      copy[key] = next;
    }
    onChange(copy);
  };

  const toggleArray = (
    key: 'crew_nationalities' | 'crew_languages',
    code: string
  ) => {
    const current = (value[key] as string[] | undefined) ?? [];
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
    set(key, next.length > 0 ? next : undefined);
  };

  // Tri-state radio for halal. Per spec S2: "Yes / No /
  // No-preference" tri-state. NEVER an unchecked
  // checkbox. The "No preference" option maps to key
  // omission; "Yes" → true; "No" → false.
  const halalState: 'true' | 'false' | 'no_preference' =
    value.halal === true
      ? 'true'
      : value.halal === false
        ? 'false'
        : 'no_preference';

  return (
    <fieldset className="space-y-5" disabled={disabled}>
      {/* Halal — tri-state */}
      <HalalTriState
        value={halalState}
        onChange={(next) => {
          if (next === 'no_preference') set('halal', undefined);
          else if (next === 'true') set('halal', true);
          else set('halal', false);
        }}
      />

      {/* Prayer setup — boolean checkbox (unchecked = key absent) */}
      <BooleanCheckbox
        name="prayer_setup"
        label="تجهيز للصلاة (سجادة + اتجاه القبلة)"
        checked={value.prayer_setup === true}
        onChange={(checked) =>
          set('prayer_setup', checked ? true : undefined)
        }
      />

      {/* Crew gender preference */}
      <CrewGenderRadio
        value={value.crew_gender_preference}
        onChange={(next) => set('crew_gender_preference', next)}
      />

      {/* Pilot nationality — single select from curated list */}
      <CountrySingleSelect
        name="pilot_nationality"
        label="جنسية الطيار المفضّلة (اختياري)"
        value={value.pilot_nationality}
        onChange={(next) => set('pilot_nationality', next)}
      />

      {/* Crew nationalities — multi-select chips */}
      <CountryChipSelect
        name="crew_nationalities"
        label="جنسيات الطاقم المفضّلة (اختياري — يمكن اختيار أكثر من واحدة)"
        selected={value.crew_nationalities ?? []}
        onToggle={(code) => toggleArray('crew_nationalities', code)}
      />

      {/* Crew languages — multi-select chips */}
      <LanguageChipSelect
        name="crew_languages"
        label="لغات الطاقم المفضّلة (اختياري)"
        selected={value.crew_languages ?? []}
        onToggle={(code) => toggleArray('crew_languages', code)}
      />

      {/* Child seats — number input */}
      <ChildSeatsInput
        value={value.child_seats}
        onChange={(next) => set('child_seats', next)}
      />

      {/* Elderly assistance — boolean checkbox */}
      <BooleanCheckbox
        name="elderly_assistance"
        label="مساعدة لكبار السن"
        checked={value.elderly_assistance === true}
        onChange={(checked) =>
          set('elderly_assistance', checked ? true : undefined)
        }
      />

      {/* Medical notes — short textarea */}
      <MedicalNotesField
        value={value.medical_notes ?? ''}
        onChange={(next) =>
          set('medical_notes', next.length > 0 ? next : undefined)
        }
      />
    </fieldset>
  );
}

// ============================================================
// Sub-fields (private to this module)
// ============================================================

function HalalTriState({
  value,
  onChange,
}: {
  value: 'true' | 'false' | 'no_preference';
  onChange: (next: 'true' | 'false' | 'no_preference') => void;
}) {
  const id = useId();
  const options: Array<{ value: typeof value; label: string }> = [
    { value: 'true', label: 'نعم — وجبات حلال مطلوبة' },
    { value: 'false', label: 'لا حاجة' },
    { value: 'no_preference', label: 'لا تفضيل' },
  ];
  return (
    <div role="radiogroup" aria-labelledby={id}>
      <span id={id} className={fieldLabel}>
        وجبات حلال
      </span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <label
              key={opt.value}
              className={cn(
                'font-ar relative flex cursor-pointer items-center justify-center rounded-md border px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'border-gold bg-gold/10 text-gold-light'
                  : 'border-border bg-navy-secondary/60 text-ink-secondary hover:border-gold/40'
              )}
            >
              <input
                type="radio"
                name="halal"
                value={opt.value}
                checked={active}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function CrewGenderRadio({
  value,
  onChange,
}: {
  value: TripPreferences['crew_gender_preference'];
  onChange: (next: TripPreferences['crew_gender_preference']) => void;
}) {
  const id = useId();
  const options: Array<{
    value: NonNullable<TripPreferences['crew_gender_preference']>;
    label: string;
  }> = [
    { value: 'male', label: 'ذكر' },
    { value: 'female', label: 'أنثى' },
    { value: 'no_preference', label: 'لا تفضيل' },
  ];
  return (
    <div role="radiogroup" aria-labelledby={id}>
      <span id={id} className={fieldLabel}>
        جنس الطاقم المفضّل (اختياري)
      </span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <label
              key={opt.value}
              className={cn(
                'font-ar relative flex cursor-pointer items-center justify-center rounded-md border px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'border-gold bg-gold/10 text-gold-light'
                  : 'border-border bg-navy-secondary/60 text-ink-secondary hover:border-gold/40'
              )}
            >
              <input
                type="radio"
                name="crew_gender_preference"
                value={opt.value}
                checked={active}
                onChange={() => onChange(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function BooleanCheckbox({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-navy-secondary/60 px-4 py-3 hover:border-gold/40"
    >
      <input
        id={id}
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-gold"
      />
      <span className="font-ar text-sm text-ink">{label}</span>
    </label>
  );
}

function CountrySingleSelect({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        className={fieldInput}
      >
        <option value="" className="bg-navy">
          — لا تفضيل —
        </option>
        {COUNTRY_OPTIONS.map((opt) => (
          <option key={opt.code} value={opt.code} className="bg-navy">
            {opt.ar} ({opt.code})
          </option>
        ))}
      </select>
    </div>
  );
}

function CountryChipSelect({
  name,
  label,
  selected,
  onToggle,
}: {
  name: string;
  label: string;
  selected: string[];
  onToggle: (code: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <span id={id} className={fieldLabel}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={id}
        data-name={name}
        className="flex flex-wrap gap-2"
      >
        {COUNTRY_OPTIONS.map((opt) => {
          const active = selected.includes(opt.code);
          return (
            <button
              type="button"
              key={opt.code}
              onClick={() => onToggle(opt.code)}
              aria-pressed={active}
              className={cn(
                'font-ar rounded-full border px-3 py-1.5 text-xs transition-colors',
                active
                  ? 'border-gold bg-gold/10 text-gold-light'
                  : 'border-border bg-navy-secondary/60 text-ink-secondary hover:border-gold/40'
              )}
            >
              {opt.ar}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LanguageChipSelect({
  name,
  label,
  selected,
  onToggle,
}: {
  name: string;
  label: string;
  selected: string[];
  onToggle: (code: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <span id={id} className={fieldLabel}>
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={id}
        data-name={name}
        className="flex flex-wrap gap-2"
      >
        {LANGUAGE_OPTIONS.map((opt) => {
          const active = selected.includes(opt.code);
          return (
            <button
              type="button"
              key={opt.code}
              onClick={() => onToggle(opt.code)}
              aria-pressed={active}
              className={cn(
                'font-ar rounded-full border px-3 py-1.5 text-xs transition-colors',
                active
                  ? 'border-gold bg-gold/10 text-gold-light'
                  : 'border-border bg-navy-secondary/60 text-ink-secondary hover:border-gold/40'
              )}
            >
              {opt.ar}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChildSeatsInput({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        كراسي أطفال (اختياري)
      </label>
      <input
        id={id}
        type="number"
        name="child_seats"
        min={0}
        max={3}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const num = Number(raw);
          if (!Number.isFinite(num) || num < 1 || num > 3) {
            // 0 is forbidden per the canonical rule; treat
            // it as "no preference" by clearing.
            onChange(undefined);
          } else {
            onChange(num);
          }
        }}
        className={fieldInput}
      />
      <span className={fieldHint}>
        من 1 إلى 3 كراسي. اتركه فارغاً إذا لا حاجة.
      </span>
    </div>
  );
}

function MedicalNotesField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={fieldLabel}>
        ملاحظات طبية (اختياري)
      </label>
      <textarea
        id={id}
        name="medical_notes"
        rows={2}
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="أمثلة: كرسي متحرك، أكسجين، طعام لمرضى السكر…"
        className={fieldInput}
      />
      <span className={fieldHint}>
        وصف موجز (حد أقصى 200 حرف).
      </span>
    </div>
  );
}
