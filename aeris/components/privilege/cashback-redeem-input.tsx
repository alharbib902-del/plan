'use client';

import { useMemo, useState } from 'react';

import { privilegeAr } from '@/lib/i18n/privilege-ar';
import { validateRedemption } from '@/lib/privilege/tier-helpers';

/**
 * Phase 13 PR 2 — Cashback redemption input for accept-offer UI.
 *
 * Dropped into the Charter/Cargo/MedEvac accept dialogs. The
 * parent owns the actual server-action call; this component is
 * client-side only: validates D7 caps live + returns the chosen
 * redemption amount via onChange.
 *
 * Usage in parent:
 *   <CashbackRedeemInput
 *     bookingTotalSar={offer.total_amount}
 *     currentBalanceSar={client.cashback_balance_sar}
 *     value={redemption}
 *     onChange={setRedemption}
 *   />
 *
 * The parent then passes `redemption` to its accept Server Action,
 * which calls `redeem_cashback_for_booking` (PR 1 §4.4 RPC) before
 * the booking is marked paid.
 */

export function CashbackRedeemInput({
  bookingTotalSar,
  currentBalanceSar,
  value,
  onChange,
  disabled = false,
}: {
  bookingTotalSar: number;
  currentBalanceSar: number;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  const [localStr, setLocalStr] = useState<string>(value === 0 ? '' : String(value));

  const maxAllowed = useMemo(
    () => Math.min(currentBalanceSar, bookingTotalSar * 0.5),
    [bookingTotalSar, currentBalanceSar]
  );

  const validation = useMemo(() => {
    if (value === 0) return { ok: true } as const;
    return validateRedemption({
      requestedSar: value,
      bookingTotalSar,
      currentBalanceSar,
    });
  }, [value, bookingTotalSar, currentBalanceSar]);

  if (currentBalanceSar <= 0) {
    return (
      <div className="rounded-lg border border-navy-card bg-navy-card/30 p-4">
        <p className="font-ar text-sm text-ink-secondary">
          لا يوجد رصيد استرداد متاح حالياً. ستكتسب استرداداً بعد تأكيد دفع هذا الحجز.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-gold/30 bg-gold/5 p-4">
      <div className="flex items-baseline justify-between">
        <label className="font-ar text-sm text-ink-primary">
          استخدام رصيد الاسترداد (اختياري)
        </label>
        <span className="font-ar text-xs text-ink-secondary">
          الرصيد: {currentBalanceSar.toLocaleString('en-US')} ريال
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={maxAllowed}
          step={1}
          value={localStr}
          onChange={(e) => {
            setLocalStr(e.target.value);
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) && n > 0 ? n : 0);
          }}
          disabled={disabled}
          placeholder="0"
          className="font-ar flex-1 rounded-lg border border-navy-card bg-navy-card/30 px-3 py-2 text-ink-primary"
        />
        <button
          type="button"
          onClick={() => {
            const max = Math.floor(maxAllowed);
            setLocalStr(String(max));
            onChange(max);
          }}
          disabled={disabled || maxAllowed < 1}
          className="font-ar rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold hover:bg-gold/20 disabled:opacity-50"
        >
          استخدم الحد الأقصى ({Math.floor(maxAllowed).toLocaleString('en-US')})
        </button>
      </div>
      <p className="font-ar text-xs text-ink-secondary">
        الحد الأقصى: 50% من قيمة الحجز ({(bookingTotalSar * 0.5).toLocaleString('en-US')} ريال).
        ١ ريال على الأقل يُدفع نقداً.
      </p>
      {validation.ok === false && (
        <p className="font-ar text-xs text-rose-300">
          {validation.error === 'redemption_amount_invalid' && 'القيمة غير صالحة'}
          {validation.error === 'insufficient_balance' && 'الرصيد غير كافٍ'}
          {validation.error === 'redemption_exceeds_cap' &&
            `الحد الأقصى المسموح: ${validation.maxAllowed?.toLocaleString('en-US')} ريال`}
          {validation.error === 'redemption_leaves_no_cash_payment' &&
            'يجب أن يبقى مبلغ نقدي (١ ريال على الأقل)'}
        </p>
      )}
    </div>
  );
}
