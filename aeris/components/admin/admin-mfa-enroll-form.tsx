'use client';

import { useEffect, useState, useTransition } from 'react';
import { Loader2, ShieldCheck, Copy } from 'lucide-react';
import QRCode from 'qrcode';

import {
  confirmMfaEnrollment,
  type ConfirmEnrollmentResult,
} from '@/app/(admin)/admin/actions/admin-mfa';

const ERROR_AR: Record<
  Exclude<ConfirmEnrollmentResult, { ok: true }>['error'],
  string
> = {
  invalid_input: 'الرمز يجب أن يكون 6 أرقام.',
  no_pending_enrollment:
    'لا توجد عملية تفعيل قيد التنفيذ. أعد تحميل الصفحة.',
  invalid_otp: 'الرمز غير صحيح. تحقّق من الوقت في هاتفك وأعد المحاولة.',
  storage_error: 'حدث خطأ مؤقت. حاول لاحقاً.',
};

export function AdminMfaEnrollForm({
  email,
  secretBase32,
  otpAuthUrl,
}: {
  email: string;
  secretBase32: string;
  otpAuthUrl: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  // Render the QR client-side using the `qrcode` package — keeps
  // the secret out of the server-rendered HTML.
  useEffect(() => {
    QRCode.toDataURL(otpAuthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: { dark: '#0A1628', light: '#FAFAFA' },
    })
      .then(setQrDataUrl)
      .catch((err) => {
        console.error('[admin-mfa-enroll] qr render failed', err);
      });
  }, [otpAuthUrl]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await confirmMfaEnrollment({ otp });
        if (!result.ok) {
          setError(ERROR_AR[result.error]);
          return;
        }
        setRecoveryCodes(result.recovery_codes);
      } catch (err) {
        console.error('[admin-mfa-enroll] confirm error', err);
        setError('تعذّر تأكيد التفعيل. حاول مرة أخرى.');
      }
    });
  };

  if (recoveryCodes) {
    return (
      <RecoveryCodesPanel codes={recoveryCodes} />
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-6 rounded-2xl border border-border bg-navy-card/50 p-6 shadow-luxury sm:p-8"
    >
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="font-ar text-lg text-ink">امسح رمز QR</h2>
          <p className="font-ar text-xs text-ink-muted" dir="ltr">
            {email}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col items-center gap-3">
          {qrDataUrl ? (
            // next/image is unsuitable for client-generated data: URLs
            // (the next/image loader expects a remote URL or static
            // import). The QR is a small base64 PNG rendered once.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="رمز QR للمصادقة الثنائية"
              width={240}
              height={240}
              className="rounded-lg bg-white p-2"
            />
          ) : (
            <div className="flex h-[240px] w-[240px] items-center justify-center rounded-lg border border-border bg-navy-secondary/40">
              <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
            </div>
          )}
          <p className="font-ar text-xs text-ink-muted">
            امسح هذا الرمز بتطبيق المصادقة على هاتفك.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="font-ar text-sm text-ink">
            أو أدخل المفتاح يدوياً في التطبيق:
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-navy-secondary/60 p-3">
            <code
              dir="ltr"
              className="flex-1 break-all font-mono text-xs text-gold-light"
            >
              {secretBase32}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(secretBase32).then(() => {
                  setSecretCopied(true);
                  setTimeout(() => setSecretCopied(false), 2000);
                });
              }}
              aria-label="نسخ المفتاح"
              className="font-ar inline-flex items-center gap-1 rounded border border-gold/40 px-2 py-1 text-xs text-gold hover:bg-gold/10"
            >
              <Copy className="h-3 w-3" />
              {secretCopied ? 'نُسخ' : 'نسخ'}
            </button>
          </div>
          <p className="font-ar text-xs text-ink-muted">
            بعد المسح، سيُظهر التطبيق رمزاً مكوّناً من 6 أرقام يتغيّر كل 30 ثانية.
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="otp-confirm"
          className="font-ar mb-2 block text-sm text-ink"
        >
          أدخل الرمز الذي يظهر في التطبيق الآن{' '}
          <span className="text-gold">*</span>
        </label>
        <input
          id="otp-confirm"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          required
          dir="ltr"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-center text-2xl tracking-[0.4em] text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </div>

      {error && (
        <p className="font-ar rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || otp.length !== 6}
        className="font-ar inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-6 py-3 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            جارٍ التحقّق...
          </>
        ) : (
          'تأكيد التفعيل'
        )}
      </button>
    </form>
  );
}

function RecoveryCodesPanel({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const formatted = codes.join('\n');

  return (
    <div className="grid gap-6 rounded-2xl border border-emerald-400/40 bg-emerald-500/5 p-6 shadow-luxury sm:p-8">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-400/40 bg-emerald-500/10 text-emerald-300">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="font-ar text-lg text-emerald-100">
            تم تفعيل المصادقة الثنائية
          </h2>
          <p className="font-ar text-xs text-emerald-100/70">
            احفظ رموز الاسترداد التالية في مكان آمن. لن تُعرض مرة أخرى.
          </p>
        </div>
      </div>

      <div
        role="alert"
        className="rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100"
      >
        <p className="font-ar">
          كل رمز يصلح لمرة واحدة فقط. استخدمها إذا فقدت الوصول إلى تطبيق
          المصادقة. عند نفاد جميع الرموز، أوقف المصادقة الثنائية ثم أعد
          تفعيلها للحصول على رموز جديدة.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {codes.map((code) => (
          <li
            key={code}
            dir="ltr"
            className="rounded-md border border-border bg-navy-secondary/40 px-3 py-2 text-center font-mono text-sm tracking-wider text-gold-light"
          >
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(formatted).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="font-ar inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm text-gold hover:bg-gold/20"
        >
          <Copy className="h-3 w-3" />
          {copied ? 'نُسخت جميع الرموز' : 'نسخ جميع الرموز'}
        </button>
        <a
          href="/admin/account/mfa"
          className="font-ar inline-flex items-center justify-center rounded-md border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20"
        >
          الانتقال إلى إدارة المصادقة
        </a>
      </div>
    </div>
  );
}
