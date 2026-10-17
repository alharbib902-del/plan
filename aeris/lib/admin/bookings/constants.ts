import type {
  BookingFlightStatus,
  BookingPaymentStatus,
} from '@/types/database';

/**
 * Admin bookings surface — isomorphic constants, Arabic labels and the
 * pure helpers shared by the Server Components, the client forms, the
 * Server Actions and the unit tests (no 'server-only' / 'use client').
 */

export const BOOKINGS_PAGE_SIZE = 50;

export const PAYMENT_STATUSES = [
  'pending_offline',
  'pending',
  'paid',
  'refunded',
] as const satisfies readonly BookingPaymentStatus[];

export const FLIGHT_STATUSES = [
  'confirmed',
  'boarding',
  'in_flight',
  'completed',
  'cancelled',
] as const satisfies readonly BookingFlightStatus[];

/** Unpaid states admin_confirm_offline_payment accepts. */
export const OFFLINE_CONFIRMABLE_PAYMENT_STATUSES: readonly BookingPaymentStatus[] =
  ['pending_offline', 'pending'];

/**
 * Mirror of the forward-only transition table enforced by
 * admin_set_flight_status (migration 20261017000002 §3). The DB is the
 * authority; this only drives which options the UI offers.
 */
export const FLIGHT_STATUS_NEXT: Record<
  BookingFlightStatus,
  readonly BookingFlightStatus[]
> = {
  confirmed: ['boarding', 'in_flight', 'completed', 'cancelled'],
  boarding: ['in_flight', 'completed', 'cancelled'],
  in_flight: ['completed'],
  completed: [],
  cancelled: [],
};

/**
 * The next flight states offered to the admin, each with the reason the
 * RPC would refuse it right now (null = allowed). Mirrors the guards of
 * admin_set_flight_status so the UI explains instead of failing; the RPC
 * re-checks everything under the booking lock.
 */
export function flightStatusOptions(b: {
  flight_status: BookingFlightStatus;
  payment_status: BookingPaymentStatus | null;
  paid_at: string | null;
  cashback_redemption_sar: number | null;
  departure_scheduled: string;
  hasActivePaymentAttempt: boolean;
  now: number;
}): { value: BookingFlightStatus; blockedReason: string | null }[] {
  const paid = b.payment_status === 'paid' || b.paid_at !== null;
  return FLIGHT_STATUS_NEXT[b.flight_status].map((value) => {
    let blockedReason: string | null = null;
    if (value === 'completed') {
      if (!paid) {
        blockedReason = 'يتطلب تأكيد استلام الدفع أولاً.';
      } else if (Date.parse(b.departure_scheduled) > b.now) {
        blockedReason = 'لم يحن موعد الإقلاع بعد.';
      }
    } else if (value === 'cancelled') {
      if (paid) {
        blockedReason = 'الحجز مدفوع — الإلغاء يتطلب استرداداً (غير متاح حالياً).';
      } else if ((b.cashback_redemption_sar ?? 0) > 0) {
        blockedReason = 'استُخدم رصيد كاش باك — الإلغاء يتطلب إرجاعه (غير متاح حالياً).';
      } else if (b.hasActivePaymentAttempt) {
        blockedReason = 'توجد محاولة دفع إلكتروني قائمة.';
      }
    }
    return { value, blockedReason };
  });
}

export const PAYMENT_STATUS_LABEL_AR: Record<BookingPaymentStatus, string> = {
  pending_offline: 'بانتظار الدفع اليدوي',
  pending: 'بانتظار الدفع',
  paid: 'مدفوع',
  refunded: 'مسترجع',
};

export const PAYMENT_STATUS_TONE: Record<BookingPaymentStatus, string> = {
  pending_offline: 'border-gold/40 bg-gold/10 text-gold-light',
  pending: 'border-gold/40 bg-gold/10 text-gold-light',
  paid: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  refunded: 'border-border bg-navy-secondary/60 text-ink-muted',
};

export const FLIGHT_STATUS_LABEL_AR: Record<BookingFlightStatus, string> = {
  confirmed: 'مؤكّدة',
  boarding: 'صعود الركاب',
  in_flight: 'في الجو',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

export const FLIGHT_STATUS_TONE: Record<BookingFlightStatus, string> = {
  confirmed: 'border-blue-400/40 bg-blue-500/10 text-blue-200',
  boarding: 'border-purple-400/40 bg-purple-500/10 text-purple-200',
  in_flight: 'border-purple-400/40 bg-purple-500/10 text-purple-200',
  completed: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200',
  cancelled: 'border-border bg-navy-secondary/60 text-ink-muted',
};

export const SOURCE_LABEL_AR: Record<string, string> = {
  charter: 'شارتر',
  empty_leg: 'رحلة فارغة',
  cargo: 'شحن',
  medevac: 'إخلاء طبي',
};

/** Server-Action / RPC error codes → Arabic banner text. */
export const BOOKING_ACTION_ERROR_AR: Record<string, string> = {
  validation_failed: 'تحقّق من الحقول المدخلة.',
  rpc_failed: 'تعذّر تنفيذ العملية. حاول مرة أخرى.',
  booking_not_found: 'الحجز غير موجود.',
  admin_not_authorized: 'حسابك لا يملك صلاحية تنفيذ هذه العملية.',
  reference_required: 'رقم المرجع (الحوالة/الإيصال) مطلوب.',
  reference_too_long: 'رقم المرجع طويل جداً (120 حرفاً كحدّ أقصى).',
  note_too_long: 'الملاحظة طويلة جداً (500 حرف كحدّ أقصى).',
  amount_invalid: 'أدخل مبلغاً صحيحاً أكبر من صفر (حتى منزلتين عشريتين).',
  amount_mismatch:
    'المبلغ المدخل لا يطابق المبلغ المستحق على الحجز. حدّث الصفحة وتحقّق من المبلغ.',
  payment_not_confirmable: 'حالة الدفع الحالية لا تسمح بتأكيد الدفع يدوياً.',
  booking_cancelled: 'لا يمكن تأكيد الدفع لحجز ملغى.',
  booking_has_active_payment:
    'توجد محاولة دفع إلكتروني قائمة لهذا الحجز. تحقّق منها لدى بوابة الدفع أولاً.',
  nothing_to_pay: 'لا يوجد مبلغ مستحق على هذا الحجز.',
  already_paid: 'هذا الحجز مدفوع مسبقاً.',
  status_required: 'اختر الحالة الجديدة.',
  transition_not_allowed: 'لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية.',
  payment_required_before_completion:
    'لا يمكن إكمال الرحلة قبل تأكيد استلام الدفع.',
  departure_in_future: 'لا يمكن إكمال رحلة لم يحن موعد إقلاعها بعد.',
  cancel_paid_requires_refund:
    'لا يمكن إلغاء حجز مدفوع من هنا — الإلغاء بعد الدفع يتطلب استرداداً (غير متاح حالياً).',
  cancel_has_cashback_redemption:
    'لا يمكن إلغاء حجز استُخدم فيه رصيد الكاش باك — يتطلب إرجاع الرصيد (غير متاح حالياً).',
  cancel_reason_required: 'سبب الإلغاء مطلوب.',
};

export function bookingActionErrorAr(code: string): string {
  return BOOKING_ACTION_ERROR_AR[code] ?? BOOKING_ACTION_ERROR_AR.rpc_failed;
}

export function isPaymentStatus(value: unknown): value is BookingPaymentStatus {
  return (
    typeof value === 'string' &&
    (PAYMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isFlightStatus(value: unknown): value is BookingFlightStatus {
  return (
    typeof value === 'string' &&
    (FLIGHT_STATUSES as readonly string[]).includes(value)
  );
}

/** `?payment=` → a known status or 'all' (unknown values fall back). */
export function parsePaymentFilter(
  raw: string | undefined
): BookingPaymentStatus | 'all' {
  const v = raw?.trim().toLowerCase();
  return isPaymentStatus(v) ? v : 'all';
}

/** `?flight=` → a known status or 'all' (unknown values fall back). */
export function parseFlightFilter(
  raw: string | undefined
): BookingFlightStatus | 'all' {
  const v = raw?.trim().toLowerCase();
  return isFlightStatus(v) ? v : 'all';
}

/** `?page=` → integer ≥ 1 (garbage → 1, capped to keep offsets sane). */
export function parsePage(raw: string | undefined): number {
  if (!raw || !/^\d{1,6}$/.test(raw.trim())) return 1;
  const n = Number.parseInt(raw.trim(), 10);
  return n >= 1 ? Math.min(n, 100000) : 1;
}

/** Builds a /admin/bookings URL preserving the active filters. */
export function bookingsListHref(params: {
  payment: BookingPaymentStatus | 'all';
  flight: BookingFlightStatus | 'all';
  page?: number;
}): string {
  const qs = new URLSearchParams();
  if (params.payment !== 'all') qs.set('payment', params.payment);
  if (params.flight !== 'all') qs.set('flight', params.flight);
  if (params.page && params.page > 1) qs.set('page', String(params.page));
  const s = qs.toString();
  return s ? `/admin/bookings?${s}` : '/admin/bookings';
}

/** Net payable = total − cashback redemption (rounded to halalas). */
export function bookingNetDue(
  totalAmount: number,
  cashbackRedemption: number | null
): number {
  return Math.round((totalAmount - (cashbackRedemption ?? 0)) * 100) / 100;
}

/** "1,150.5" style SAR amount with up to 2 decimals (latin digits). */
export function formatSARExact(amount: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

/** Riyadh-zoned Arabic date+time (gregorian, latin digits), or —. */
export function formatRiyadhDateTime(value: string | null): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

/**
 * "RUH → JED". Render inside dir="ltr": IATA runs are LTR, so an RTL
 * arrow between two of them would point the wrong way.
 */
export function formatBookingRoute(row: {
  route_origin_iata: string | null;
  route_destination_iata: string | null;
  route_origin_freeform_snapshot: string | null;
  route_destination_freeform_snapshot: string | null;
}): string {
  const from = row.route_origin_iata ?? row.route_origin_freeform_snapshot ?? '—';
  const to =
    row.route_destination_iata ?? row.route_destination_freeform_snapshot ?? '—';
  return `${from} → ${to}`;
}
