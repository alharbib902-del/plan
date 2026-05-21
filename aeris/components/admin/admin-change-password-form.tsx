'use client';

import { useState, useTransition } from 'react';
import { KeyRound, Loader2, ShieldAlert } from 'lucide-react';

import {
  changePassword,
  type ChangePasswordResult,
} from '@/app/(admin)/admin/actions/admin-account';

const ERROR_AR: Record<
  Exclude<ChangePasswordResult, { ok: true }>['error'],
  string
> = {
  invalid_input:
    'تحقّق من الحقول. تأكد من ملء كلمة المرور الحالية والجديدة والتأكيد.',
  current_invalid: 'كلمة المرور الحالية غير صحيحة.',
  new_weak:
    'كلمة المرور الجديدة ضعيفة. يجب أن تحتوي على حرف صغير وحرف كبير ورقم.',
  new_too_short: 'كلمة المرور الجديدة قصيرة (الحد الأدنى 12 حرفاً).',
  new_too_long: 'كلمة المرور الجديدة طويلة (الحد الأقصى 128 حرفاً).',
  new_same_as_current: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.',
  storage_error: 'حدث خطأ أثناء حفظ التعديل. حاول لاحقاً.',
};

export function AdminChangePasswordForm({
  email,
  mustChangePassword,
}: {
  email: string;
  mustChangePassword: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    const formData = new FormData(event.currentTarget);
    const payload = {
      current_password: String(formData.get('current_password') ?? ''),
      new_password: String(formData.get('new_password') ?? ''),
      confirm_password: String(formData.get('confirm_password') ?? ''),
    };

    startTransition(async () => {
      try {
        const result = await changePassword(payload);
        if (!result.ok) {
          setError(ERROR_AR[result.error]);
          return;
        }
        setSuccess(true);
        // Brief delay so the user sees the success banner before
        // landing on the dashboard. Hard nav so the layout re-
        // evaluates the must_change_password gate (now cleared).
        setTimeout(() => {
          window.location.href = '/admin/leads';
        }, 800);
      } catch (err) {
        console.error('[admin-change-password] error', err);
        setError('تعذّر تغيير كلمة المرور. حاول مرة أخرى.');
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
          <KeyRound className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h1 className="font-ar text-lg text-ink">تغيير كلمة المرور</h1>
          <p className="font-ar text-xs text-ink-muted" dir="ltr">
            {email}
          </p>
        </div>
      </div>

      {mustChangePassword && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm text-amber-100"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="font-ar">
            هذا حسابك الأول. لا يمكن الوصول إلى بقية صفحات الإدارة حتى
            تختار كلمة مرور جديدة قوية.
          </p>
        </div>
      )}

      <div>
        <label
          htmlFor="current-password"
          className="font-ar mb-2 block text-sm text-ink"
        >
          كلمة المرور الحالية <span className="text-gold">*</span>
        </label>
        <input
          id="current-password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          maxLength={128}
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </div>

      <div>
        <label
          htmlFor="new-password"
          className="font-ar mb-2 block text-sm text-ink"
        >
          كلمة المرور الجديدة <span className="text-gold">*</span>
        </label>
        <input
          id="new-password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          required
          dir="ltr"
          minLength={12}
          maxLength={128}
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
        <p className="font-ar mt-1 text-xs text-ink-muted">
          12-128 حرفاً، تحتوي على حرف صغير وحرف كبير ورقم على الأقل.
        </p>
      </div>

      <div>
        <label
          htmlFor="confirm-password"
          className="font-ar mb-2 block text-sm text-ink"
        >
          تأكيد كلمة المرور الجديدة <span className="text-gold">*</span>
        </label>
        <input
          id="confirm-password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          dir="ltr"
          maxLength={128}
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-base text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </div>

      {error && (
        <p className="font-ar rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {success && (
        <p className="font-ar rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          تم تغيير كلمة المرور بنجاح. جارٍ التحويل…
        </p>
      )}

      <button
        type="submit"
        disabled={pending || success}
        className="font-ar inline-flex items-center justify-center gap-2 rounded-md bg-gold-shine px-6 py-3 text-base font-medium text-navy shadow-gold transition-all hover:shadow-gold-glow disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            جارٍ الحفظ...
          </>
        ) : (
          'حفظ كلمة المرور الجديدة'
        )}
      </button>
    </form>
  );
}
