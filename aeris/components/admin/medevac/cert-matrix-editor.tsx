'use client';

import { useState, useTransition } from 'react';

import {
  upsertMedicalCertification,
  type UpsertMedicalCertificationInput,
} from '@/app/actions/medevac-admin';
import { medevacAr } from '@/lib/i18n/medevac-ar';
import { datetimeLocalToRiyadhIso } from '@/lib/utils/datetime-local';
import type {
  AircraftMedicalCertificationRow,
  MedicalCertifyingAuthority,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 1 — admin /admin/medevac/medical-certifications
 * matrix editor.
 *
 * Renders one row per aircraft with the current cert state
 * (supports_BMT/ALS/CCT/repatriation + authority + expiry +
 * cert number + notes). Inline edit form per row; save calls
 * upsertMedicalCertification Server Action.
 *
 * The DB trigger enforce_aircraft_medical_certifications_trigger
 * enforces the three structural rules; the Server Action
 * surfaces the SQLSTATE codes (22023 / 23514) as cleaner
 * structured errors which we map to user-facing copy here.
 */

export interface AircraftWithCert {
  aircraft_id: string;
  aircraft_label: string;
  operator_label: string;
  cert: AircraftMedicalCertificationRow | null;
}

const AUTHORITY_LABELS: Record<MedicalCertifyingAuthority, string> = {
  SCFHS: 'هيئة التخصصات الصحية (SCFHS)',
  civil_aviation_authority: 'الطيران المدني (GACA)',
  foreign_equivalent: 'هيئة أجنبية مكافئة',
  other: 'أخرى',
};

const ERROR_COPY: Record<string, string> = {
  aircraft_id_required: 'معرّف الطائرة مطلوب',
  at_least_one_supports_required:
    'يجب اختيار قدرة طبية واحدة على الأقل',
  certifying_authority_invalid: 'جهة الاعتماد غير صالحة',
  certification_expires_at_required: 'تاريخ انتهاء الشهادة مطلوب',
  certification_expires_at_invalid: 'تاريخ غير صالح',
  expires_in_past: 'تاريخ الانتهاء يجب أن يكون في المستقبل',
  expires_in_past_or_reenable_blocked:
    'لا يمكن إعادة تفعيل قدرة على شهادة منتهية — حدّث تاريخ الانتهاء أولاً',
  flag_disabled: 'الخدمة غير مفعلة حالياً',
  server_error: 'حدث خطأ في الخادم',
};

export function CertMatrixEditor({ rows }: { rows: AircraftWithCert[] }) {
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <CertRow key={row.aircraft_id} row={row} />
      ))}
    </div>
  );
}

function CertRow({ row }: { row: AircraftWithCert }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'ok' } | { kind: 'err'; message: string }
  >({ kind: 'idle' });

  const existing = row.cert;
  const [bmt, setBmt] = useState(existing?.supports_BMT ?? false);
  const [als, setAls] = useState(existing?.supports_ALS ?? false);
  const [cct, setCct] = useState(existing?.supports_CCT ?? false);
  const [repat, setRepat] = useState(existing?.supports_repatriation ?? false);
  const [authority, setAuthority] = useState<MedicalCertifyingAuthority>(
    existing?.certifying_authority ?? 'SCFHS'
  );
  const [certNumber, setCertNumber] = useState(
    existing?.certification_number ?? ''
  );
  const [expiresAt, setExpiresAt] = useState(
    existing?.certification_expires_at
      ? toLocalIsoDate(existing.certification_expires_at)
      : ''
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');

  function onSave() {
    setStatus({ kind: 'idle' });
    const payload: UpsertMedicalCertificationInput = {
      aircraft_id: row.aircraft_id,
      supports_BMT: bmt,
      supports_ALS: als,
      supports_CCT: cct,
      supports_repatriation: repat,
      certifying_authority: authority,
      certification_number: certNumber.trim() === '' ? null : certNumber.trim(),
      certification_expires_at: toIsoTimestamp(expiresAt),
      notes: notes.trim() === '' ? null : notes.trim(),
    };

    startTransition(async () => {
      const result = await upsertMedicalCertification(payload);
      if (result.ok) {
        setStatus({ kind: 'ok' });
      } else {
        setStatus({
          kind: 'err',
          message: ERROR_COPY[result.error] ?? result.error,
        });
      }
    });
  }

  return (
    <div className="rounded-xl border border-border bg-navy-card/30 p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h3 className="font-ar text-base text-ink-primary">
            <span dir="ltr">{row.aircraft_label}</span>
          </h3>
          <p className="font-ar text-xs text-ink-muted">
            {row.operator_label}
          </p>
        </div>
        {existing && (
          <span className="font-ar text-xs text-ink-muted">
            آخر تحديث: {fmtDate(existing.updated_at)}
          </span>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="font-ar mb-1 text-xs text-ink-secondary">
            القدرات الطبية
          </legend>
          <Toggle label="BMT" checked={bmt} onChange={setBmt} />
          <Toggle label="ALS" checked={als} onChange={setAls} />
          <Toggle label="CCT" checked={cct} onChange={setCct} />
          <Toggle
            label="إعادة عبر الحدود"
            checked={repat}
            onChange={setRepat}
          />
        </fieldset>

        <div className="space-y-3">
          <div>
            <label className="font-ar mb-1 block text-xs text-ink-secondary">
              جهة الاعتماد
            </label>
            <select
              value={authority}
              onChange={(e) =>
                setAuthority(e.target.value as MedicalCertifyingAuthority)
              }
              className="font-ar w-full rounded-lg border border-white/10 bg-navy/60 px-3 py-2 text-sm text-ink-primary"
            >
              {(Object.keys(AUTHORITY_LABELS) as MedicalCertifyingAuthority[]).map(
                (a) => (
                  <option key={a} value={a}>
                    {AUTHORITY_LABELS[a]}
                  </option>
                )
              )}
            </select>
          </div>

          <div>
            <label className="font-ar mb-1 block text-xs text-ink-secondary">
              رقم الشهادة (اختياري)
            </label>
            <input
              type="text"
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              dir="ltr"
              className="font-ar w-full rounded-lg border border-white/10 bg-navy/60 px-3 py-2 text-sm text-ink-primary"
            />
          </div>

          <div>
            <label className="font-ar mb-1 block text-xs text-ink-secondary">
              تاريخ انتهاء الشهادة
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              dir="ltr"
              className="font-ar w-full rounded-lg border border-white/10 bg-navy/60 px-3 py-2 text-sm text-ink-primary"
            />
          </div>

          <div>
            <label className="font-ar mb-1 block text-xs text-ink-secondary">
              ملاحظات (اختياري)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="font-ar w-full rounded-lg border border-white/10 bg-navy/60 px-3 py-2 text-sm text-ink-primary"
            />
          </div>
        </div>
      </div>

      <footer className="mt-4 flex items-center justify-between">
        <div className="text-xs">
          {status.kind === 'ok' && (
            <span className="font-ar text-emerald-300">تم الحفظ ✓</span>
          )}
          {status.kind === 'err' && (
            <span className="font-ar text-rose-300">{status.message}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="font-ar rounded-lg bg-gold px-5 py-2 text-sm font-medium text-navy transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      </footer>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-navy/30 px-3 py-2">
      <span className="font-ar text-sm text-ink-primary">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-gold"
      />
    </label>
  );
}

function toLocalIsoDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function toIsoTimestamp(local: string): string {
  if (!local) return '';
  // Round 2 PR #76 P2 #3 fix — use the shared
  // datetimeLocalToRiyadhIso helper (lib/utils/datetime-local.ts).
  // `<input type="datetime-local">` yields a naive string with no
  // timezone; `new Date(local).toISOString()` interpreted it in
  // the admin's BROWSER zone, which would shift certification
  // expiry by the admin's local offset on every non-Riyadh
  // browser (cron expiry-flip + warning cascade would then
  // misfire by that offset). The helper appends `+03:00`
  // unconditionally so the value is always interpreted as
  // Riyadh wall time, matching the Phase 7 invariant used by
  // every other datetime-local form in the project (operator
  // publish, admin publish, Phase 9 charter, …).
  try {
    return datetimeLocalToRiyadhIso(local);
  } catch {
    return local;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
