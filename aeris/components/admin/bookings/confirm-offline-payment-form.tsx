'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { confirmOfflinePayment } from '@/app/(admin)/admin/actions/bookings';
import {
  bookingActionErrorAr,
  formatSARExact,
} from '@/lib/admin/bookings/constants';
import { clientsAr } from '@/lib/i18n/clients-ar';

const INPUT =
  'font-ar mt-1 block w-full rounded-lg border border-border bg-navy-secondary/60 px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-gold/50 focus:outline-none';

/**
 * «تأكيد استلام الدفع يدوياً» — manual-settlement confirmation. The admin
 * re-states the amount received; the RPC flips the booking to paid only
 * when it equals the booking's net due at commit time.
 */
export function ConfirmOfflinePaymentForm({
  bookingId,
  bookingNumber,
  netDue,
}: {
  bookingId: string;
  bookingNumber: string;
  netDue: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState(String(netDue));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!reference.trim()) {
      setFieldErrors({ reference: 'reference_required' });
      return;
    }

    const ok = window.confirm(
      `تأكيد استلام ${amount} ${clientsAr.currencySAR} للحجز ${bookingNumber}؟\n` +
        `المرجع: ${reference.trim()}\n` +
        'سيصبح الحجز «مدفوعاً» نهائياً ولا يمكن التراجع، وسيُحتسب الكاش باك والمستوى تلقائياً.'
    );
    if (!ok) return;

    startTransition(async () => {
      const result = await confirmOfflinePayment({
        booking_id: bookingId,
        received_amount: amount,
        reference,
        note: note || undefined,
      });
      if (result.ok) {
        // The revalidated page drops this form once the booking is paid,
        // so the success banner is rendered by the page from `?done=`.
        router.replace(
          `/admin/bookings/${bookingId}?done=${result.already_paid ? 'already_paid' : 'paid'}`,
          { scroll: false }
        );
        return;
      }
      setFieldErrors(result.field_errors ?? {});
      const base = bookingActionErrorAr(result.error);
      setError(
        result.error === 'amount_mismatch' && result.expected_amount !== undefined
          ? `${base} المبلغ المستحق: ${formatSARExact(result.expected_amount)} ${clientsAr.currencySAR}.`
          : base
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="offline-amount" className="font-ar text-xs text-ink-muted">
          المبلغ المستلم ({clientsAr.currencySAR})
        </label>
        <input
          id="offline-amount"
          name="received_amount"
          inputMode="decimal"
          dir="ltr"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={INPUT}
          aria-invalid={fieldErrors.received_amount ? true : undefined}
        />
        {fieldErrors.received_amount ? (
          <p className="font-ar mt-1 text-xs text-rose-200">
            {bookingActionErrorAr(fieldErrors.received_amount)}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="offline-reference" className="font-ar text-xs text-ink-muted">
          رقم المرجع (الحوالة / الإيصال) *
        </label>
        <input
          id="offline-reference"
          name="reference"
          required
          maxLength={120}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className={INPUT}
          aria-invalid={fieldErrors.reference ? true : undefined}
        />
        {fieldErrors.reference ? (
          <p className="font-ar mt-1 text-xs text-rose-200">
            {bookingActionErrorAr(fieldErrors.reference)}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="offline-note" className="font-ar text-xs text-ink-muted">
          ملاحظة (اختياري)
        </label>
        <textarea
          id="offline-note"
          name="note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={INPUT}
        />
        {fieldErrors.note ? (
          <p className="font-ar mt-1 text-xs text-rose-200">
            {bookingActionErrorAr(fieldErrors.note)}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="font-ar w-full rounded-lg border border-gold/60 bg-gold/15 px-4 py-2.5 text-sm text-gold-light transition-colors hover:bg-gold/25 disabled:opacity-50"
      >
        {isPending ? 'جارٍ التأكيد…' : 'تأكيد استلام الدفع يدوياً'}
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
