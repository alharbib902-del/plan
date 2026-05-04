'use client';

import { useState, useTransition } from 'react';
import { Loader2, Send, Copy, Check } from 'lucide-react';
import { dispatchTrip } from '@/app/(admin)/admin/actions/trips';

interface DispatchFormProps {
  tripRequestId: string;
  initialOperatorPhone?: string | null;
  initialOperatorUrl?: string | null;
  initialWhatsAppLink?: string | null;
  initialExpiresAt?: string | null;
}

function formatDateTimeAr(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DispatchForm({
  tripRequestId,
  initialOperatorPhone,
  initialOperatorUrl,
  initialWhatsAppLink,
  initialExpiresAt,
}: DispatchFormProps) {
  const [operatorPhone, setOperatorPhone] = useState(
    initialOperatorPhone ?? ''
  );
  const [operatorUrl, setOperatorUrl] = useState(initialOperatorUrl ?? '');
  const [whatsAppLink, setWhatsAppLink] = useState(
    initialWhatsAppLink ?? ''
  );
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt ?? '');
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedWa, setCopiedWa] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.append('trip_request_id', tripRequestId);
    formData.append('operator_phone', operatorPhone);

    startTransition(async () => {
      const result = await dispatchTrip(formData);
      if (!result.ok) {
        setError(translateError(result.error));
        return;
      }
      setOperatorUrl(result.operator_url);
      setWhatsAppLink(result.whatsapp_link);
      setExpiresAt(result.expires_at);
    });
  };

  const handleCopy = async (
    value: string,
    setFlag: (b: boolean) => void
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      setFlag(true);
      setTimeout(() => setFlag(false), 1800);
    } catch {
      // ignore — user can long-press / select manually
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
            رقم واتساب المشغّل (E.164)
          </span>
          <input
            dir="ltr"
            type="tel"
            value={operatorPhone}
            onChange={(e) => setOperatorPhone(e.target.value)}
            placeholder="+966500000000"
            required
            className="font-ar mt-1 block w-full rounded-md border border-border bg-navy-secondary/80 px-3 py-2 text-sm text-ink placeholder:text-ink-muted hover:border-gold/40 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
          />
        </label>
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
          {operatorUrl ? 'إعادة الإرسال للمشغّل' : 'إرسال للمشغّل'}
        </button>
        {error && (
          <p className="font-ar text-xs text-red-300" role="alert">
            {error}
          </p>
        )}
      </form>

      {operatorUrl && (
        <div className="space-y-3 rounded-lg border border-gold/30 bg-gold/5 p-4">
          <p className="font-ar text-xs text-gold-light">
            تم إنشاء الرابط. انسخ رابط واتساب وأرسله للمشغّل يدويًا.
          </p>
          <div className="space-y-2">
            <CopyRow
              label="رابط المشغّل"
              value={operatorUrl}
              copied={copiedUrl}
              onCopy={() => handleCopy(operatorUrl, setCopiedUrl)}
            />
            {whatsAppLink && (
              <CopyRow
                label="رابط واتساب"
                value={whatsAppLink}
                copied={copiedWa}
                onCopy={() => handleCopy(whatsAppLink, setCopiedWa)}
                external
              />
            )}
          </div>
          {expiresAt && (
            <p className="font-ar text-xs text-ink-muted">
              ينتهي الرابط في {formatDateTimeAr(expiresAt)}.
            </p>
          )}
        </div>
      )}
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
      <div className="font-ar text-xs uppercase tracking-tagged text-ink-muted">
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <input
          dir="ltr"
          readOnly
          value={value}
          className="block w-full rounded-md border border-border bg-navy-secondary/60 px-3 py-2 font-mono text-xs text-ink-secondary"
        />
        {external && (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="font-ar inline-flex items-center gap-1 rounded-md border border-border bg-navy-secondary/60 px-3 py-2 text-xs text-ink-secondary hover:border-gold/40 hover:text-gold-light"
          >
            فتح
          </a>
        )}
        <button
          type="button"
          onClick={onCopy}
          className="font-ar inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold-light hover:bg-gold/20"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
          {copied ? 'نُسخ' : 'نسخ'}
        </button>
      </div>
    </div>
  );
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_input':
      return 'صيغة الرقم غير صحيحة. أدخل رقمًا دوليًا يبدأ بـ + .';
    case 'env_missing':
      return 'إعدادات الخادم ناقصة. تواصل مع مسؤول النظام.';
    case 'trip_closed':
      return 'هذه الرحلة لم تعد قابلة للإرسال (محجوزة أو ملغاة). حدّث الصفحة لمراجعة الحالة الحالية.';
    case 'trip_not_found':
      return 'تعذّر العثور على هذه الرحلة. ربما حُذفت — حدّث الصفحة.';
    case 'failed':
    default:
      return 'تعذّر إرسال الرحلة الآن. حاول مرة أخرى.';
  }
}
