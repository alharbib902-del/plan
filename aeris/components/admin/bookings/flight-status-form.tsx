'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { setBookingFlightStatus } from '@/app/(admin)/admin/actions/bookings';
import {
  FLIGHT_STATUS_LABEL_AR,
  bookingActionErrorAr,
} from '@/lib/admin/bookings/constants';
import { cn } from '@/lib/utils/cn';
import type { BookingFlightStatus } from '@/types/database';

export interface FlightStatusOption {
  value: BookingFlightStatus;
  /** Why the server will refuse it right now (UI hint; the RPC decides). */
  blockedReason: string | null;
}

const INPUT =
  'font-ar mt-1 block w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-gold/50 focus:outline-none';

export function FlightStatusForm({
  bookingId,
  bookingNumber,
  current,
  options,
}: {
  bookingId: string;
  bookingNumber: string;
  current: BookingFlightStatus;
  options: FlightStatusOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const firstAllowed = options.find((o) => o.blockedReason === null)?.value;
  const [status, setStatus] = useState<BookingFlightStatus | ''>(
    firstAllowed ?? ''
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selected = options.find((o) => o.value === status);
  const isCancel = status === 'cancelled';

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!status || !selected || selected.blockedReason) {
      setError(bookingActionErrorAr('status_required'));
      return;
    }
    if (isCancel && !note.trim()) {
      setError(bookingActionErrorAr('cancel_reason_required'));
      return;
    }

    const ok = window.confirm(
      `تغيير حالة رحلة الحجز ${bookingNumber} من «${FLIGHT_STATUS_LABEL_AR[current]}» إلى «${FLIGHT_STATUS_LABEL_AR[status]}»؟\n` +
        'لا يمكن الرجوع إلى حالة سابقة.' +
        (status === 'completed' ? '\nسيتمكّن العميل من تقييم الرحلة.' : '')
    );
    if (!ok) return;

    startTransition(async () => {
      const result = await setBookingFlightStatus({
        booking_id: bookingId,
        status,
        note: note || undefined,
      });
      if (result.ok) {
        setNote('');
        router.replace(`/admin/bookings/${bookingId}?done=flight`, {
          scroll: false,
        });
        return;
      }
      const fieldCode = result.field_errors
        ? Object.values(result.field_errors)[0]
        : undefined;
      setError(bookingActionErrorAr(fieldCode ?? result.error));
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <fieldset>
        <legend className="font-ar text-xs text-ink-muted">الحالة الجديدة</legend>
        <div className="mt-2 grid gap-2">
          {options.map((o) => (
            <label
              key={o.value}
              className={cn(
                'font-ar flex items-start gap-2 rounded-lg border p-3 text-sm',
                o.blockedReason
                  ? 'cursor-not-allowed border-border/60 bg-navy-secondary/30 text-ink-muted'
                  : status === o.value
                    ? 'cursor-pointer border-gold/60 bg-gold/10 text-ink'
                    : 'cursor-pointer border-border bg-navy-secondary/60 text-ink'
              )}
            >
              <input
                type="radio"
                name="flight_status"
                value={o.value}
                checked={status === o.value}
                disabled={o.blockedReason !== null}
                onChange={() => setStatus(o.value)}
                className="mt-1 accent-gold"
              />
              <span>
                {FLIGHT_STATUS_LABEL_AR[o.value]}
                {o.blockedReason ? (
                  <span className="mt-0.5 block text-xs">{o.blockedReason}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="flight-note" className="font-ar text-xs text-ink-muted">
          {isCancel ? 'سبب الإلغاء *' : 'ملاحظة (اختياري)'}
        </label>
        <textarea
          id="flight-note"
          name="note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={INPUT}
        />
      </div>

      <button
        type="submit"
        disabled={isPending || !firstAllowed}
        className="font-ar w-full rounded-lg border border-gold/60 bg-gold/15 px-4 py-2.5 text-sm text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-50"
      >
        {isPending ? 'جارٍ التحديث…' : 'تحديث حالة الرحلة'}
      </button>

      {error ? (
        <p
          role="alert"
          className="font-ar rounded-md border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
