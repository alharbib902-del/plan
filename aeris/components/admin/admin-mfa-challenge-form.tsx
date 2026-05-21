'use client';

import { useEffect, useState, useTransition } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';

import {
  verifyMfaChallenge,
  type VerifyMfaChallengeResult,
} from '@/app/(admin)/admin/actions/admin-mfa';

const ERROR_AR: Record<
  Exclude<VerifyMfaChallengeResult, { ok: true }>['error'],
  string
> = {
  invalid_input: 'البيانات غير مكتملة. أدخل الرمز كاملاً.',
  no_active_mfa: 'لا توجد مصادقة ثنائية مفعّلة على هذا الحساب.',
  invalid_code: 'الرمز غير صحيح. حاول مرة أخرى.',
  replay_same_step: 'هذا الرمز استُخدم للتو. انتظر حتى ظهور رمز جديد.',
  rate_limited: 'تم تجاوز الحدّ المسموح من المحاولات. حاول بعد قليل.',
  storage_error: 'حدث خطأ مؤقت. حاول لاحقاً.',
};

export function AdminMfaChallengeForm({
  email,
  mfaAlreadyVerified,
  mustChangePassword,
}: {
  email: string;
  mfaAlreadyVerified: boolean;
  mustChangePassword: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'otp' | 'recovery'>('otp');
  const [code, setCode] = useState('');

  // If MFA was already cleared (concurrent verify in another
  // tab), bounce immediately.
  useEffect(() => {
    if (mfaAlreadyVerified) {
      window.location.href = mustChangePassword
        ? '/admin/account/password'
        : '/admin/leads';
    }
  }, [mfaAlreadyVerified, mustChangePassword]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await verifyMfaChallenge({ kind, code });
        if (!result.ok) {
          setError(ERROR_AR[result.error]);
          return;
        }
        // Success — navigate based on must_change_password.
        window.location.href = result.must_change_password
          ? '/admin/account/password'
          : '/admin/leads';
      } catch (err) {
        console.error('[admin-mfa-challenge] error', err);
        setError('تعذّر التحقّق. حاول مرة أخرى.');
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-5 rounded-2xl border border-border bg-navy-card/50 p-6 shadow-luxury sm:p-8"
    >
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-gold">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-ar text-lg text-ink">التحقّق الثنائي</h1>
          <p className="font-ar text-xs text-ink-muted" dir="ltr">
            {email}
          </p>
        </div>
      </div>

      <div role="tablist" className="flex rounded-md border border-border bg-navy-secondary/60">
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'otp'}
          onClick={() => {
            setKind('otp');
            setCode('');
            setError(null);
          }}
          className={`font-ar flex-1 rounded-md px-4 py-2 text-sm transition-colors ${
            kind === 'otp'
              ? 'bg-gold/20 text-gold'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          رمز التطبيق
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'recovery'}
          onClick={() => {
            setKind('recovery');
            setCode('');
            setError(null);
          }}
          className={`font-ar flex-1 rounded-md px-4 py-2 text-sm transition-colors ${
            kind === 'recovery'
              ? 'bg-gold/20 text-gold'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          رمز الاسترداد
        </button>
      </div>

      {kind === 'otp' ? (
        <div>
          <label
            htmlFor="otp-code"
            className="font-ar mb-2 block text-sm text-ink"
          >
            رمز التحقّق المكوّن من 6 أرقام <span className="text-gold">*</span>
          </label>
          <input
            id="otp-code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            autoComplete="one-time-code"
            required
            dir="ltr"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-center text-2xl tracking-[0.4em] text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
          />
          <p className="font-ar mt-2 text-xs text-ink-muted">
            افتح تطبيق المصادقة على هاتفك (Google Authenticator، Authy…) وأدخل
            الرمز الحالي.
          </p>
        </div>
      ) : (
        <div>
          <label
            htmlFor="recovery-code"
            className="font-ar mb-2 block text-sm text-ink"
          >
            رمز الاسترداد <span className="text-gold">*</span>
          </label>
          <input
            id="recovery-code"
            type="text"
            autoComplete="off"
            required
            dir="ltr"
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-EFGH-JKLM"
            className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-center text-lg tracking-wider text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
          />
          <p className="font-ar mt-2 text-xs text-ink-muted">
            استخدم أحد رموز الاسترداد المحفوظة لديك. كل رمز يصلح لمرة واحدة فقط.
          </p>
        </div>
      )}

      {error && (
        <p className="font-ar rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || code.length === 0}
        className="font-ar inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-6 py-3 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            جارٍ التحقّق...
          </>
        ) : (
          <>
            <KeyRound className="h-4 w-4" aria-hidden />
            تحقّق
          </>
        )}
      </button>
    </form>
  );
}
