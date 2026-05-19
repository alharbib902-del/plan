'use client';

import { useState, useTransition } from 'react';

import {
  acceptMyMedevacOffer,
  declineMyMedevacOffer,
  cancelMyMedevacRequest,
} from '@/app/actions/medevac-clients';
import { CashbackRedeemInput } from '@/components/privilege/cashback-redeem-input';

const ERROR_COPY: Record<string, string> = {
  flag_disabled: 'الخدمة غير مفعلة',
  unauthorized: 'الجلسة منتهية',
  validation_failed: 'البيانات غير صحيحة',
  server_error: 'خطأ في الخادم',
  offer_not_found: 'العرض غير موجود',
  request_not_found: 'الطلب غير موجود',
  offer_not_pending: 'العرض ليس في حالة الانتظار',
  offer_expired: 'العرض منتهي الصلاحية',
  request_not_open: 'الطلب لم يعد مفتوحاً للقبول',
  request_expired: 'الطلب منتهي الصلاحية',
  request_not_cancellable: 'الطلب في حالة لا تسمح بالإلغاء',
  not_your_request: 'هذا الطلب ليس باسمك',
  forbidden: 'غير مصرح',
  reason_too_long: 'سبب طويل جداً (الحد 500 حرف)',
};

export function AcceptOfferButton({
  offerId,
  offerTotalSar,
  cashbackBalanceSar = 0,
  privilegeEnabled = false,
}: {
  offerId: string;
  /** Required when privilegeEnabled = true. Non-covered medevac
   *  bookings only (covered J5 bookings have no cash flow — the
   *  parent page suppresses the input by passing
   *  privilegeEnabled=false). */
  offerTotalSar?: number;
  cashbackBalanceSar?: number;
  privilegeEnabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [redemption, setRedemption] = useState<number>(0);
  const [redeemWarning, setRedeemWarning] = useState<string | null>(null);

  const showRedemption =
    privilegeEnabled && cashbackBalanceSar > 0 && typeof offerTotalSar === 'number';

  return (
    <div className="flex flex-col items-stretch gap-2">
      {showRedemption && offerTotalSar !== undefined ? (
        <CashbackRedeemInput
          bookingTotalSar={offerTotalSar}
          currentBalanceSar={cashbackBalanceSar}
          value={redemption}
          onChange={setRedemption}
          disabled={pending}
        />
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('قبول هذا العرض سيُلغي باقي العروض. متابعة؟')) return;
          setError(null);
          setRedeemWarning(null);
          startTransition(async () => {
            const r = await acceptMyMedevacOffer({
              offer_id: offerId,
              ...(redemption > 0
                ? { cashback_redemption_sar: redemption }
                : {}),
            });
            if (!r.ok) {
              setError(ERROR_COPY[r.error] ?? 'خطأ');
              return;
            }
            if (
              r.cashback_redemption &&
              r.cashback_redemption.ok === false
            ) {
              setRedeemWarning(
                'تم القبول، لكن لم يُحسم رصيد الاسترداد. ادفع المبلغ كاملاً نقداً.'
              );
            }
          });
        }}
        className="font-ar self-end rounded-lg bg-emerald-500 px-4 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'جاري…' : 'قبول'}
      </button>
      {error && <span className="font-ar text-xs text-rose-300">{error}</span>}
      {redeemWarning && (
        <span className="font-ar text-xs text-amber-200">{redeemWarning}</span>
      )}
    </div>
  );
}

export function DeclineOfferButton({ offerId }: { offerId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-ar text-xs text-rose-300 hover:text-rose-200"
      >
        رفض
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="سبب الرفض (اختياري، ≤ 500 حرف)"
        maxLength={500}
        rows={2}
        className="font-ar rounded border border-white/10 bg-navy/60 px-2 py-1 text-xs text-ink-primary"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await declineMyMedevacOffer({
                offer_id: offerId,
                reason: reason || undefined,
              });
              if (!r.ok) setError(ERROR_COPY[r.error] ?? 'خطأ');
              else setOpen(false);
            });
          }}
          className="font-ar rounded bg-rose-500 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {pending ? 'جاري…' : 'تأكيد'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-ar rounded border border-white/10 px-3 py-1 text-xs text-ink-secondary"
        >
          إلغاء
        </button>
      </div>
      {error && <span className="font-ar text-xs text-rose-300">{error}</span>}
    </div>
  );
}

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-ar rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/20"
      >
        إلغاء الطلب
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
      <p className="font-ar text-xs text-rose-200">
        تأكيد إلغاء الطلب — سيتم رفض جميع العروض المعلقة.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="سبب الإلغاء (اختياري)"
        maxLength={500}
        rows={2}
        className="font-ar rounded border border-white/10 bg-navy/60 px-2 py-1 text-sm text-ink-primary"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await cancelMyMedevacRequest({
                request_id: requestId,
                reason: reason || undefined,
              });
              if (!r.ok) setError(ERROR_COPY[r.error] ?? 'خطأ');
            });
          }}
          className="font-ar rounded bg-rose-500 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? 'جاري…' : 'تأكيد الإلغاء'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="font-ar rounded border border-white/10 px-3 py-1.5 text-sm text-ink-secondary"
        >
          تراجع
        </button>
      </div>
      {error && <span className="font-ar text-xs text-rose-300">{error}</span>}
    </div>
  );
}
