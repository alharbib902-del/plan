'use client';

import { useState, useTransition } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { signIn, type SignInResult } from '@/app/(admin)/admin/actions/admin-auth';
import { PasswordInput } from '@/components/ui/password-input';

const ERROR_AR: Record<Exclude<SignInResult, { ok: true }>['error'], string> = {
  env: 'الإعدادات غير مكتملة. تواصل مع مسؤول النظام.',
  // Anti-enumeration: same message whether the email doesn't
  // exist, the account is disabled, or the password is wrong.
  invalid_credentials: 'بيانات الدخول غير صحيحة.',
  invalid_input: 'من فضلك أدخل البريد الإلكتروني وكلمة المرور.',
  rate_limited: 'تم إيقاف محاولات الدخول مؤقتاً. حاول مرة أخرى بعد قليل.',
};

export function AdminLoginForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const result = await signIn(formData);
        if (!result.ok) {
          setError(ERROR_AR[result.error]);
          return;
        }
        // Successful login. Navigation priority (highest wins):
        //   1. mfa_required → /admin/login/mfa (PR-3b — must
        //      complete the OTP challenge before any other
        //      admin surface is reachable; the layout gate
        //      enforces this server-side too).
        //   2. must_change_password → /admin/account/password
        //   3. default → /admin/leads
        // Using window.location.href (hard nav) so the server
        // layout re-evaluates all gates on the next request.
        if (result.mfa_required) {
          window.location.href = '/admin/login/mfa';
        } else if (result.must_change_password) {
          window.location.href = '/admin/account/password';
        } else {
          window.location.href = '/admin/leads';
        }
      } catch (err) {
        console.error('[admin-login] sign-in error', err);
        setError('تعذّر تسجيل الدخول. حاول مرة أخرى.');
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
          <h1 className="font-ar text-lg text-ink">تسجيل دخول الفريق</h1>
          <p className="font-ar text-xs text-ink-muted">
            وصول مخصص لفريق Aeris فقط.
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="admin-email"
          className="font-ar mb-2 block text-sm text-ink"
        >
          البريد الإلكتروني
          <span className="text-gold"> *</span>
        </label>
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          dir="ltr"
          maxLength={254}
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </div>

      <div>
        <label
          htmlFor="admin-password"
          className="font-ar mb-2 block text-sm text-ink"
        >
          كلمة المرور
          <span className="text-gold"> *</span>
        </label>
        <PasswordInput
          id="admin-password"
          name="password"
          autoComplete="current-password"
          required
          dir="ltr"
          maxLength={128}
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink placeholder:text-ink-muted/70 focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </div>

      {error && (
        <p className="font-ar rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="font-ar inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-6 py-3 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            جاري الدخول...
          </>
        ) : (
          'دخول'
        )}
      </button>
    </form>
  );
}
