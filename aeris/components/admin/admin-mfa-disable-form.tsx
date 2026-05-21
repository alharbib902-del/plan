'use client';

import { useState, useTransition } from 'react';
import { Loader2, ShieldOff } from 'lucide-react';

import {
  disableMfaForCurrentAdmin,
  type DisableMfaResult,
} from '@/app/(admin)/admin/actions/admin-mfa';

const ERROR_AR: Record<
  Exclude<DisableMfaResult, { ok: true }>['error'],
  string
> = {
  invalid_input: 'املأ كلمة المرور والرمز.',
  current_invalid: 'كلمة المرور غير صحيحة.',
  invalid_otp: 'الرمز غير صحيح.',
  replay_same_step: 'هذا الرمز استُخدم للتو. انتظر حتى ظهور رمز جديد.',
  no_active_mfa: 'لا توجد مصادقة ثنائية مفعّلة.',
  storage_error: 'حدث خطأ مؤقت. حاول لاحقاً.',
};

export function AdminMfaDisableForm() {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const payload = {
      current_password: String(formData.get('current_password') ?? ''),
      otp: String(formData.get('otp') ?? ''),
    };

    startTransition(async () => {
      try {
        const result = await disableMfaForCurrentAdmin(payload);
        if (!result.ok) {
          setError(ERROR_AR[result.error]);
          return;
        }
        setSuccess(true);
        setTimeout(() => {
          window.location.reload();
        }, 800);
      } catch (err) {
        console.error('[admin-mfa-disable] error', err);
        setError('تعذّر إيقاف المصادقة. حاول مرة أخرى.');
      }
    });
  };

  if (!open) {
    return (
      <div className="rounded-xl border border-rose-400/40 bg-rose-500/5 p-5">
        <p className="font-ar text-sm text-rose-100">
          إيقاف المصادقة الثنائية يُضعف حماية حسابك. تأكّد أنك تفهم ذلك.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-ar mt-3 inline-flex items-center gap-2 rounded-md border border-rose-400/50 bg-rose-500/10 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/20"
        >
          <ShieldOff className="h-4 w-4" />
          إيقاف المصادقة
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-xl border border-rose-400/40 bg-rose-500/5 p-5"
    >
      <p className="font-ar text-sm text-rose-100">
        لإيقاف المصادقة الثنائية، أعد إدخال كلمة المرور وأدخل رمز التحقّق
        الحالي من تطبيقك.
      </p>

      <div>
        <label
          htmlFor="disable-current-password"
          className="font-ar mb-2 block text-sm text-ink"
        >
          كلمة المرور الحالية <span className="text-gold">*</span>
        </label>
        <input
          id="disable-current-password"
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
          htmlFor="disable-otp"
          className="font-ar mb-2 block text-sm text-ink"
        >
          رمز المصادقة الحالي <span className="text-gold">*</span>
        </label>
        <input
          id="disable-otp"
          name="otp"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          autoComplete="one-time-code"
          required
          dir="ltr"
          maxLength={6}
          placeholder="000000"
          className="font-ar block w-full rounded-md border border-border bg-navy-secondary/60 px-4 py-3 text-center text-xl tracking-[0.4em] text-ink focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
        />
      </div>

      {error && (
        <p className="font-ar rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {success && (
        <p className="font-ar rounded-md border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          تم إيقاف المصادقة الثنائية. جارٍ تحديث الصفحة…
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || success}
          className="font-ar inline-flex items-center gap-2 rounded-md border border-rose-400/50 bg-rose-500/15 px-4 py-2 text-sm text-rose-100 hover:bg-rose-500/25 disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ الإيقاف...
            </>
          ) : (
            'تأكيد الإيقاف'
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending || success}
          className="font-ar inline-flex items-center rounded-md border border-border bg-navy-secondary/60 px-4 py-2 text-sm text-ink-secondary hover:bg-navy-secondary/80 disabled:opacity-60"
        >
          تراجع
        </button>
      </div>
    </form>
  );
}
