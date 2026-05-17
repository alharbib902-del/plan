'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { subscribeToAerisShield } from '@/app/actions/medevac-clients';
import type { AerisShieldPlanTerms } from '@/lib/medevac/plan-terms';

interface Props {
  plans: AerisShieldPlanTerms[];
}

interface MemberRow {
  name: string;
  relationship: string;
  dob: string;
}

const ERROR_COPY: Record<string, string> = {
  flag_disabled: 'الخدمة غير مفعلة',
  unauthorized: 'الجلسة منتهية',
  validation_failed: 'البيانات غير صحيحة',
  server_error: 'خطأ في الخادم',
  client_not_found: 'حساب العميل غير موجود',
  client_full_name_missing: 'يجب إكمال اسمك الكامل في الملف الشخصي أولاً',
  owner_dob_required: 'تاريخ ميلاد المالك مطلوب',
  owner_dob_invalid: 'تاريخ ميلاد المالك غير صحيح',
  plan_invalid: 'خطة الاشتراك غير صحيحة',
  plan_terms_not_found: 'تعذّر تحميل شروط الخطة',
  covered_members_exceed_plan_cap:
    'عدد الأعضاء أكبر من الحد المسموح للخطة',
  covered_members_duplicate_pair: 'يوجد اسم + تاريخ ميلاد مكرر',
};

export function ShieldSubscribeForm({ plans }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{
    subscription_number: string;
  } | null>(null);

  const [plan, setPlan] = useState<AerisShieldPlanTerms['plan']>('individual');
  const [ownerDob, setOwnerDob] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);

  const selectedPlan = plans.find((p) => p.plan === plan);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setTopError(null);
    setFieldErrors({});

    const payload = {
      plan,
      owner_dob: ownerDob,
      covered_members: members.filter(
        (m) => m.name.trim() !== '' || m.dob.trim() !== ''
      ),
    };

    try {
      const result = await subscribeToAerisShield(payload);
      if (result.ok) {
        setSuccess({ subscription_number: result.subscription_number });
        router.refresh();
      } else {
        if (result.field_errors) setFieldErrors(result.field_errors);
        setTopError(ERROR_COPY[result.error] ?? 'خطأ غير متوقع');
      }
    } catch (err) {
      console.error('[shield-subscribe-form] submit threw', err);
      setTopError('خطأ غير متوقع');
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
        <h2 className="font-ar text-2xl text-emerald-300">
          تم إنشاء اشتراك Aeris Shield
        </h2>
        <p className="font-ar mt-4 text-sm text-ink-secondary">
          رقم الاشتراك:{' '}
          <span dir="ltr" className="font-mono text-emerald-200">
            {success.subscription_number}
          </span>
        </p>
        <p className="font-ar mt-4 text-sm text-ink-secondary">
          الاشتراك في حالة <strong>الانتظار للدفع</strong> — تواصل مع
          الإدارة لإتمام الدفع وتفعيل الاشتراك.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      {topError && (
        <p
          role="alert"
          className="font-ar rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
        >
          {topError}
        </p>
      )}

      <fieldset>
        <legend className="font-ar mb-3 text-sm text-ink-secondary">
          اختر الخطة
        </legend>
        <div className="grid gap-3 md:grid-cols-2">
          {plans.map((p) => (
            <label
              key={p.plan}
              className={`flex cursor-pointer flex-col rounded-xl border p-4 transition-colors ${
                plan === p.plan
                  ? 'border-gold/50 bg-gold/5'
                  : 'border-white/10 bg-navy/40 hover:border-white/30'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-ar text-base text-ink-primary">
                  {p.description ?? p.plan}
                </span>
                <input
                  type="radio"
                  name="plan"
                  value={p.plan}
                  checked={plan === p.plan}
                  onChange={() => setPlan(p.plan)}
                  className="cursor-pointer accent-gold"
                />
              </div>
              <p className="font-ar mt-2 text-sm text-ink-secondary">
                <span dir="ltr" className="font-mono">
                  {p.annual_fee_sar.toLocaleString('en-US')}
                </span>{' '}
                ريال / سنة ·{' '}
                <span dir="ltr">
                  {p.covered_events === -1 ? '∞' : p.covered_events}
                </span>{' '}
                حدث · <span dir="ltr">{p.service_level}</span>
                {p.includes_repatriation && ' · إعادة عبر الحدود'}
              </p>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="owner_dob"
          className="font-ar mb-2 block text-sm text-ink-secondary"
        >
          تاريخ ميلادك (المالك)
          <span className="ms-1 text-rose-400">*</span>
        </label>
        <input
          id="owner_dob"
          name="owner_dob"
          type="date"
          value={ownerDob}
          onChange={(e) => setOwnerDob(e.target.value)}
          required
          dir="ltr"
          className="font-ar w-full rounded-xl border border-white/10 bg-navy/60 px-4 py-3 text-ink-primary"
        />
        {fieldErrors['owner_dob'] && (
          <p className="font-ar mt-1 text-xs text-rose-300">
            {fieldErrors['owner_dob']}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="font-ar mb-2 text-sm text-ink-secondary">
          أعضاء إضافيون (اختياري) — الحد الأقصى:{' '}
          {selectedPlan?.max_covered_members ?? '—'} عضو (شامل المالك)
        </legend>
        {members.map((m, i) => (
          <div
            key={i}
            className="mb-3 grid gap-2 rounded-lg border border-white/10 bg-navy/30 p-3 md:grid-cols-3"
          >
            <input
              type="text"
              placeholder="اسم العضو"
              value={m.name}
              onChange={(e) => {
                const next = [...members];
                next[i] = { ...next[i]!, name: e.target.value };
                setMembers(next);
              }}
              className="font-ar rounded border border-white/10 bg-navy/60 px-3 py-2 text-sm text-ink-primary"
            />
            <input
              type="text"
              placeholder="صلة القرابة"
              value={m.relationship}
              onChange={(e) => {
                const next = [...members];
                next[i] = { ...next[i]!, relationship: e.target.value };
                setMembers(next);
              }}
              className="font-ar rounded border border-white/10 bg-navy/60 px-3 py-2 text-sm text-ink-primary"
            />
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={m.dob}
                onChange={(e) => {
                  const next = [...members];
                  next[i] = { ...next[i]!, dob: e.target.value };
                  setMembers(next);
                }}
                dir="ltr"
                className="font-ar flex-1 rounded border border-white/10 bg-navy/60 px-3 py-2 text-sm text-ink-primary"
              />
              <button
                type="button"
                onClick={() =>
                  setMembers(members.filter((_, j) => j !== i))
                }
                className="font-ar text-xs text-rose-300 hover:text-rose-200"
              >
                حذف
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setMembers([
              ...members,
              { name: '', relationship: '', dob: '' },
            ])
          }
          className="font-ar rounded-lg border border-dashed border-white/20 px-3 py-1.5 text-xs text-ink-secondary hover:border-white/40"
        >
          + إضافة عضو
        </button>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="font-ar w-full rounded-xl bg-gold py-3 text-lg font-medium text-navy hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'جاري الإرسال…' : 'تأكيد الاشتراك'}
      </button>
    </form>
  );
}
