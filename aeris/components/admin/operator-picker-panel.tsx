'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  Phone,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  dispatchTripV2,
  type DispatchTripV2DispatchEntry,
} from '@/app/(admin)/admin/actions/trips';
import type { DispatchOperator } from '@/lib/supabase/queries/operators-list';

const MAX_TOTAL_PHONES = 8;
const MAX_MANUAL_PHONES = 3;
const MIN_PHONES = 1;
const TOP_N = 5;

/**
 * Phase 5.x Semi-Auto Operator Picker.
 *
 * Replaces the raw 1..8 phone-input panel with a checkbox-based
 * picker over every approved operator in the DB, augmented with a
 * lightweight score so the founder can pick the strongest
 * candidates in one click. Falls back to manual phone entry (up to
 * 3 numbers on top of the picked ones) for operators that aren't
 * registered yet.
 *
 * Submit path is identical to the legacy panel: combine selected
 * phones + manual phones into a single `phones` FormData array and
 * call `dispatchTripV2`. No backend change.
 */
export interface OperatorPickerPanelProps {
  tripRequestId: string;
  isClosed: boolean;
  currentDispatches: DispatchTripV2DispatchEntry[];
  operators: DispatchOperator[];
}

export function OperatorPickerPanel({
  tripRequestId,
  isClosed,
  currentDispatches,
  operators,
}: OperatorPickerPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [manualPhones, setManualPhones] = useState<string[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasCurrent = currentDispatches.length > 0;
  const selectedCount = selectedIds.size;
  const manualCount = manualPhones.filter((p) => p.trim().length > 0).length;
  const totalCount = selectedCount + manualCount;

  const operatorsById = useMemo(() => {
    const map = new Map<string, DispatchOperator>();
    for (const op of operators) map.set(op.id, op);
    return map;
  }, [operators]);

  const topNIds = useMemo(
    () => operators.slice(0, TOP_N).map((op) => op.id),
    [operators]
  );

  const toggle = (id: string) => {
    setError(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size + manualCount >= MAX_TOTAL_PHONES) {
          setError(`الحد الأقصى ${MAX_TOTAL_PHONES} مشغّلين في إرسال واحد.`);
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const selectTopN = () => {
    setError(null);
    const next = new Set<string>();
    for (const id of topNIds) {
      if (next.size + manualCount >= MAX_TOTAL_PHONES) break;
      next.add(id);
    }
    setSelectedIds(next);
  };

  const selectAll = () => {
    setError(null);
    const next = new Set<string>();
    for (const op of operators) {
      if (next.size + manualCount >= MAX_TOTAL_PHONES) break;
      next.add(op.id);
    }
    setSelectedIds(next);
  };

  const clearAll = () => {
    setError(null);
    setSelectedIds(new Set());
  };

  const addManualRow = () => {
    if (manualPhones.length >= MAX_MANUAL_PHONES) return;
    setManualPhones((prev) => [...prev, '']);
  };
  const updateManualRow = (index: number, value: string) => {
    setManualPhones((prev) => prev.map((p, i) => (i === index ? value : p)));
  };
  const removeManualRow = (index: number) => {
    setManualPhones((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const pickedPhones: string[] = [];
    for (const id of selectedIds) {
      const op = operatorsById.get(id);
      if (op) pickedPhones.push(op.contact_phone.trim());
    }
    const manualTrimmed = manualPhones
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const combined = [...pickedPhones, ...manualTrimmed];

    if (combined.length < MIN_PHONES) {
      setError('اختر مشغّلًا واحدًا على الأقل أو أضف رقمًا يدويًا.');
      return;
    }
    if (combined.length > MAX_TOTAL_PHONES) {
      setError(`الحد الأقصى ${MAX_TOTAL_PHONES} مشغّلين في إرسال واحد.`);
      return;
    }
    if (new Set(combined).size !== combined.length) {
      setError('لا يمكن تكرار نفس الرقم في نفس الإرسال.');
      return;
    }

    const formData = new FormData();
    formData.append('trip_request_id', tripRequestId);
    for (const p of combined) formData.append('phones', p);

    startTransition(async () => {
      const result = await dispatchTripV2(formData);
      if (!result.ok) {
        setError(translateError(result.error));
        return;
      }
      setSelectedIds(new Set());
      setManualPhones([]);
      setManualOpen(false);
    });
  };

  const ctaLabel = hasCurrent
    ? `إعادة الإرسال إلى (${totalCount}) مشغّل${totalCount === 1 ? '' : 'ين'}`
    : `إرسال إلى (${totalCount}) مشغّل${totalCount === 1 ? '' : 'ين'}`;

  return (
    <div className="space-y-4">
      {hasCurrent && (
        <div className="space-y-3 rounded-lg border border-gold/30 bg-gold/5 p-4">
          <p className="font-ar text-xs text-gold-light">
            الجولة الحالية ({currentDispatches.length} مشغّل
            {currentDispatches.length === 1 ? '' : 'ين'}). انسخ كل رابط واتساب
            وأرسله للمشغّل المعنيّ يدويًا.
          </p>
          <div className="space-y-3">
            {currentDispatches.map((d) => (
              <DispatchCard key={d.target_id} dispatch={d} />
            ))}
          </div>
        </div>
      )}

      {isClosed ? (
        <p className="font-ar rounded-md border border-border bg-navy-secondary/40 p-3 text-xs text-ink-muted">
          هذه الرحلة مغلقة (محجوزة أو ملغاة) ولا يمكن إعادة إرسالها.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-ar text-sm font-medium text-ink">
                اختر المشغّلين للإرسال
              </h4>
              <span className="font-ar inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs text-gold-light">
                <Users className="h-3 w-3" aria-hidden />
                {totalCount}/{MAX_TOTAL_PHONES}
              </span>
            </div>
            <p className="font-ar text-xs text-ink-muted">
              المشغّلون مرتّبون حسب نتيجة الأولوية (التقادم + النشاط + اكتمال
              الحساب). يمكنك اختيار حتى {MAX_TOTAL_PHONES} مشغّلين مجتمعين.
              {hasCurrent && (
                <span className="mt-1 block text-amber-200">
                  إعادة الإرسال ستُلغي روابط الجولة الحالية وتفتح جولة جديدة.
                  العروض المستلمة من الجولة السابقة تبقى ظاهرة وقابلة للقبول.
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectTopN}
              disabled={pending || operators.length === 0}
              className="font-ar inline-flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs text-gold-light transition-colors hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              اختر أفضل {TOP_N}
            </button>
            <button
              type="button"
              onClick={selectAll}
              disabled={pending || operators.length === 0}
              className="font-ar inline-flex items-center gap-1.5 rounded-md border border-border bg-navy-secondary/60 px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              اختر الكل
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={pending || selectedCount === 0}
              className="font-ar inline-flex items-center gap-1.5 rounded-md border border-border bg-navy-secondary/60 px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:border-red-400/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              مسح
            </button>
          </div>

          {operators.length === 0 ? (
            <p className="font-ar rounded-md border border-dashed border-border bg-navy-secondary/30 p-4 text-center text-xs text-ink-muted">
              لا يوجد مشغّلون مُعتمدون بعد. أضف أرقامًا يدويًا أدناه.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {operators.map((op) => (
                <OperatorCard
                  key={op.id}
                  operator={op}
                  selected={selectedIds.has(op.id)}
                  onToggle={() => toggle(op.id)}
                  disabled={pending}
                />
              ))}
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-border bg-navy-secondary/30 p-3">
            <button
              type="button"
              onClick={() => setManualOpen((v) => !v)}
              className="font-ar flex w-full items-center justify-between text-xs text-ink-secondary hover:text-gold-light"
              aria-expanded={manualOpen}
            >
              <span className="inline-flex items-center gap-1.5">
                {manualOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                )}
                أو أدخل أرقام إضافية يدوياً
                {manualCount > 0 && (
                  <span className="font-ar rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] text-gold-light">
                    {manualCount}
                  </span>
                )}
              </span>
              <span className="font-ar text-[10px] text-ink-muted">
                حتى {MAX_MANUAL_PHONES} أرقام
              </span>
            </button>
            {manualOpen && (
              <div className="space-y-2 pt-2">
                {manualPhones.length === 0 ? (
                  <p className="font-ar text-[11px] text-ink-muted">
                    لا توجد أرقام يدوية. أضف رقمًا للبدء.
                  </p>
                ) : (
                  manualPhones.map((phone, index) => (
                    <ManualPhoneRow
                      key={index}
                      index={index}
                      value={phone}
                      onChange={(v) => updateManualRow(index, v)}
                      onRemove={() => removeManualRow(index)}
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={addManualRow}
                  disabled={
                    manualPhones.length >= MAX_MANUAL_PHONES || pending
                  }
                  className="font-ar inline-flex items-center gap-1.5 rounded-md border border-border bg-navy-secondary/60 px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  إضافة رقم يدوي
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={pending || totalCount === 0}
            className="font-ar inline-flex w-full items-center justify-center gap-2 rounded-md border border-gold/50 bg-gold/10 px-4 py-2.5 text-sm text-gold-light transition-all hover:border-gold hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Send className="h-4 w-4" aria-hidden />
            )}
            {ctaLabel}
          </button>

          {error && (
            <p className="font-ar text-xs text-red-300" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function OperatorCard({
  operator,
  selected,
  onToggle,
  disabled,
}: {
  operator: DispatchOperator;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const containerClasses = selected
    ? 'border-gold bg-gold/5 ring-1 ring-gold/40 shadow-lg shadow-gold/10'
    : 'border-border bg-navy-secondary/40 hover:border-gold/40';

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={`group flex w-full flex-col gap-2 rounded-lg border p-3 text-start transition-all disabled:cursor-not-allowed disabled:opacity-60 ${containerClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
              selected
                ? 'border-gold bg-gold text-navy'
                : 'border-border bg-navy-secondary/80 group-hover:border-gold/60'
            }`}
          >
            {selected && <Check className="h-3.5 w-3.5" aria-hidden />}
          </span>
          <div className="space-y-0.5">
            <div className="font-ar text-sm font-medium text-ink">
              {operator.company_name}
            </div>
            <div className="font-ar text-[10px] text-ink-muted">
              معتمد {formatRelative(operator.approved_at)}
            </div>
          </div>
        </div>
        <span className="font-ar inline-flex items-center justify-center rounded-lg border border-gold/50 bg-gold/10 px-3 py-1 text-2xl font-semibold leading-none text-gold-light">
          {operator.score}
        </span>
      </div>

      <div className="space-y-1 border-t border-border/60 pt-2">
        <div className="flex items-center gap-1.5">
          <Phone
            className="h-3 w-3 shrink-0 text-ink-muted"
            aria-hidden
          />
          <span
            dir="ltr"
            className="font-ar text-xs text-gold-light"
          >
            {operator.contact_phone}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Mail className="h-3 w-3 shrink-0 text-ink-muted" aria-hidden />
          <span
            dir="ltr"
            className="font-ar truncate text-[11px] text-ink-secondary"
          >
            {operator.contact_email}
          </span>
        </div>
        <div className="font-ar text-[10px] text-ink-muted">
          {operator.last_login_at
            ? `آخر دخول: ${formatRelative(operator.last_login_at)}`
            : 'لم يسجّل دخول بعد'}
        </div>
      </div>
    </button>
  );
}

function ManualPhoneRow({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <input
        dir="ltr"
        type="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="+966500000000"
        aria-label={`رقم يدوي ${index + 1}`}
        className="font-ar block w-full rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink placeholder:text-ink-muted hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`حذف الرقم اليدوي ${index + 1}`}
        className="inline-flex items-center justify-center rounded-md border border-border bg-navy-secondary/60 px-3 text-ink-muted transition-colors hover:border-red-400/40 hover:text-red-200"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function DispatchCard({
  dispatch,
}: {
  dispatch: DispatchTripV2DispatchEntry;
}) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedWa, setCopiedWa] = useState(false);

  const copy = async (value: string, setter: (b: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(value);
      setter(true);
      setTimeout(() => setter(false), 1800);
    } catch {
      // ignore — admin can long-press / select manually
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-navy-secondary/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span dir="ltr" className="font-ar text-xs text-ink-secondary">
          {dispatch.target_phone}
        </span>
        <span className="font-ar text-[10px] text-ink-muted">
          ينتهي {formatExpires(dispatch.expires_at)}
        </span>
      </div>
      <CopyRow
        label="رابط المشغّل"
        value={dispatch.operator_url}
        copied={copiedUrl}
        onCopy={() => copy(dispatch.operator_url, setCopiedUrl)}
      />
      <CopyRow
        label="رابط واتساب"
        value={dispatch.whatsapp_link}
        copied={copiedWa}
        onCopy={() => copy(dispatch.whatsapp_link, setCopiedWa)}
        external
      />
    </div>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
  external,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  external?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="font-ar text-[10px] uppercase tracking-tagged text-ink-muted">
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <input
          dir="ltr"
          readOnly
          value={value}
          className="block w-full rounded-md border border-border bg-navy-secondary/60 px-2 py-1.5 font-mono text-[11px] text-ink-secondary"
        />
        {external && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="فتح الرابط"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-navy-secondary/60 px-2 text-xs text-ink-secondary hover:border-gold/40 hover:text-gold-light"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="font-ar inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2 text-xs text-gold-light hover:bg-gold/20"
        >
          {copied ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {copied ? 'نُسخ' : 'نسخ'}
        </button>
      </div>
    </div>
  );
}

function formatExpires(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'short',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const deltaSec = (Date.now() - ms) / 1000;
  if (deltaSec < 0) return 'قريبًا';
  if (deltaSec < 60) return 'الآن';
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `منذ ${days} يوم`;
  const months = Math.floor(days / 30);
  if (months < 12) return `منذ ${months} شهر`;
  const years = Math.floor(months / 12);
  return `منذ ${years} سنة`;
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_input':
      return 'تحقّق من صيغة الأرقام (مثال: +966500000000) ومن عدم تكرارها.';
    case 'env_missing':
      return 'إعدادات الخادم ناقصة. تواصل مع مسؤول النظام.';
    case 'trip_not_found':
      return 'تعذّر العثور على هذه الرحلة. ربما حُذفت — حدّث الصفحة.';
    case 'trip_not_open':
      return 'هذه الرحلة لم تعد قابلة للإرسال (محجوزة أو ملغاة).';
    case 'invalid_targets':
      return 'بيانات الإرسال غير صالحة. حدّث الصفحة وحاول مجددًا.';
    case 'failed':
    default:
      return 'تعذّر الإرسال الآن. حاول مرة أخرى.';
  }
}
