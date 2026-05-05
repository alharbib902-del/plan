'use client';

import { useState, useTransition } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  dispatchTripV2,
  type DispatchTripV2DispatchEntry,
} from '@/app/(admin)/admin/actions/trips';

const MAX_PHONES = 8;
const MIN_PHONES = 1;

/**
 * Phase 5 multi-operator dispatch panel.
 *
 * Renders:
 *   1. The current pending targets (rebuilt from the persisted
 *      trip_dispatch_targets rows by the page server-side, then
 *      passed in as `currentDispatches`). On every page render
 *      these cards reproduce the same operator URLs the original
 *      Server Action returned at dispatch time — byte-identical
 *      because both paths derive `issued_at` from the persisted
 *      `sent_at`. Spec acceptance #14a / #34a.
 *   2. A multi-row form (1..8 E.164 phones with +/− controls)
 *      that calls `dispatchTripV2`. On success, the page
 *      revalidates and the new round's targets re-render via (1).
 *
 * The panel hides the form (read-only) when the trip is booked
 * or cancelled; the spec explicitly disallows re-dispatch from
 * those terminal states.
 */
export interface DispatchPanelV2Props {
  tripRequestId: string;
  isClosed: boolean;
  currentDispatches: DispatchTripV2DispatchEntry[];
  initialPhones?: string[];
}

export function DispatchPanelV2({
  tripRequestId,
  isClosed,
  currentDispatches,
  initialPhones,
}: DispatchPanelV2Props) {
  const [phones, setPhones] = useState<string[]>(
    initialPhones && initialPhones.length > 0 ? initialPhones : ['']
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasCurrent = currentDispatches.length > 0;
  const ctaLabel = hasCurrent
    ? 'إعادة الإرسال إلى مشغّلين جدد'
    : 'إرسال إلى المشغّلين';

  const addRow = () => {
    if (phones.length >= MAX_PHONES) return;
    setPhones((prev) => [...prev, '']);
  };
  const removeRow = (index: number) => {
    setPhones((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length === 0 ? [''] : next;
    });
  };
  const updateRow = (index: number, value: string) => {
    setPhones((prev) => prev.map((p, i) => (i === index ? value : p)));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = phones.map((p) => p.trim()).filter((p) => p.length > 0);
    if (trimmed.length < MIN_PHONES) {
      setError('أضف رقم مشغّل واحدًا على الأقل.');
      return;
    }
    if (trimmed.length > MAX_PHONES) {
      setError(`الحد الأقصى ${MAX_PHONES} مشغّلين في إرسال واحد.`);
      return;
    }
    if (new Set(trimmed).size !== trimmed.length) {
      setError('لا يمكن تكرار نفس الرقم في نفس الإرسال.');
      return;
    }

    const formData = new FormData();
    formData.append('trip_request_id', tripRequestId);
    for (const p of trimmed) formData.append('phones', p);

    startTransition(async () => {
      const result = await dispatchTripV2(formData);
      if (!result.ok) {
        setError(translateError(result.error));
        return;
      }
      // Success: the Server Action's revalidatePath() triggers a
      // server re-render, which will re-feed `currentDispatches`
      // from listCurrentRoundTargets. Reset the form so the next
      // re-dispatch starts clean.
      setPhones(['']);
    });
  };

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
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="font-ar text-xs text-ink-muted">
            أضف من 1 إلى {MAX_PHONES} أرقام واتساب للمشغّلين. ستُولَّد روابط
            موقّعة منفصلة لكل مشغّل، صالحة لمدة 72 ساعة.
            {hasCurrent && (
              <span className="mt-1 block text-amber-200">
                إعادة الإرسال ستُلغي روابط الجولة الحالية وتفتح جولة جديدة.
                العروض المستلمة من الجولة السابقة تبقى ظاهرة وقابلة للقبول.
              </span>
            )}
          </p>
          <div className="space-y-2">
            {phones.map((phone, index) => (
              <PhoneRow
                key={index}
                index={index}
                value={phone}
                onChange={(v) => updateRow(index, v)}
                onRemove={() => removeRow(index)}
                canRemove={phones.length > 1}
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={addRow}
              disabled={phones.length >= MAX_PHONES || pending}
              className="font-ar inline-flex items-center gap-1.5 rounded-md border border-border bg-navy-secondary/60 px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:border-gold/40 hover:text-gold-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              إضافة مشغّل
            </button>
            <span className="font-ar text-xs text-ink-muted">
              {phones.length}/{MAX_PHONES}
            </span>
          </div>
          <button
            type="submit"
            disabled={pending}
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

function PhoneRow({
  index,
  value,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <input
        dir="ltr"
        type="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="+966500000000"
        aria-label={`رقم المشغّل ${index + 1}`}
        className="font-ar block w-full rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink placeholder:text-ink-muted hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`حذف المشغّل ${index + 1}`}
        className="inline-flex items-center justify-center rounded-md border border-border bg-navy-secondary/60 px-3 text-ink-muted transition-colors hover:border-red-400/40 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-30"
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
