import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import {
  FlightStatusBadge,
  PaymentStatusBadge,
} from '@/components/admin/bookings/booking-status-badges';
import { ConfirmOfflinePaymentForm } from '@/components/admin/bookings/confirm-offline-payment-form';
import { FlightStatusForm } from '@/components/admin/bookings/flight-status-form';
import { formatSARLabel } from '@/components/clients/offer-format';
import { ADDONS_BY_SUBTYPE } from '@/lib/addons/catalog';
import {
  OFFLINE_CONFIRMABLE_PAYMENT_STATUSES,
  SOURCE_LABEL_AR,
  flightStatusOptions,
  formatBookingRoute,
  formatRiyadhDateTime,
  formatSARExact,
} from '@/lib/admin/bookings/constants';
import { getAdminBookingDetail } from '@/lib/admin/bookings/queries';
import { clientsAr } from '@/lib/i18n/clients-ar';
import { formatPhone } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفاصيل الحجز',
  robots: { index: false, follow: false },
};

interface BookingDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ done?: string }>;
}

const DONE_MESSAGE: Record<string, string> = {
  paid: 'تم تأكيد استلام الدفع وتحويل الحجز إلى «مدفوع». يُحتسب الكاش باك والمستوى تلقائياً.',
  already_paid: 'هذا الحجز مدفوع مسبقاً — لم يُسجَّل أي تغيير.',
  flight: 'تم تحديث حالة الرحلة.',
};

const PROVIDER_LABEL_AR: Record<string, string> = {
  offline: 'يدوي (تحويل/واتساب)',
  hyperpay: 'HyperPay',
  moyasar: 'Moyasar',
};

const LEDGER_STATUS_LABEL_AR: Record<string, string> = {
  initiated: 'قيد التنفيذ',
  success: 'ناجحة',
  failed: 'فاشلة',
  refunded: 'مستردة',
};

const ADDON_STATUS_LABEL_AR: Record<string, string> = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكّدة',
  delivered: 'منفّذة',
  cancelled: 'ملغاة',
};

function sar(amount: number | null): string {
  return amount === null ? '—' : `${formatSARExact(amount)} ${clientsAr.currencySAR}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px,1fr] gap-3 border-t border-border/60 py-3 sm:grid-cols-[160px,1fr]">
      <dt className="font-ar text-xs text-ink-muted">{label}</dt>
      <dd className="font-ar text-sm text-ink">{children}</dd>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-navy-card/40 p-5 sm:p-6">
      <h2 className="font-ar text-base font-medium text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export default async function AdminBookingDetailPage({
  params,
  searchParams,
}: BookingDetailPageProps) {
  const { id } = await params;
  const { done } = (await searchParams) ?? {};
  const bundle = await getAdminBookingDetail(id);
  if (!bundle) notFound();

  const { booking, netDue, client, operatorName, sourceHref, addons, payments } =
    bundle;
  const isPaid = booking.payment_status === 'paid' || booking.paid_at !== null;
  const canConfirmOffline =
    !isPaid &&
    booking.flight_status !== 'cancelled' &&
    !bundle.hasActivePaymentAttempt &&
    OFFLINE_CONFIRMABLE_PAYMENT_STATUSES.includes(booking.payment_status);
  const options = flightStatusOptions({
    flight_status: booking.flight_status,
    payment_status: booking.payment_status,
    paid_at: booking.paid_at,
    cashback_redemption_sar: booking.cashback_redemption_sar,
    departure_scheduled: booking.departure_scheduled,
    hasActivePaymentAttempt: bundle.hasActivePaymentAttempt,
    now: Date.now(),
  });
  const operatorHref =
    booking.operator_id && process.env.ENABLE_OPERATOR_PORTAL_ADMIN === 'true'
      ? `/admin/operators/${booking.operator_id}`
      : null;
  const doneMessage = done ? DONE_MESSAGE[done] : undefined;

  return (
    <section>
      <Link
        href="/admin/bookings"
        className="font-ar group inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-gold"
      >
        <ArrowLeft
          className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180"
          aria-hidden
        />
        العودة لقائمة الحجوزات
      </Link>

      {doneMessage ? (
        <p
          role="status"
          className="font-ar mt-4 rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-3 text-sm text-emerald-200"
        >
          {doneMessage}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr,1fr] lg:items-start">
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-navy-card/40 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-mono text-sm text-gold-light" dir="ltr">
                  {booking.booking_number}
                </div>
                <h1 className="font-ar mt-1 text-2xl text-ink">
                  {client.name ?? 'بدون اسم'}
                </h1>
                {client.phone ? (
                  <a
                    href={`https://wa.me/${client.phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-ar mt-1 inline-block text-sm text-ink-muted transition-colors hover:text-gold"
                    dir="ltr"
                  >
                    {formatPhone(client.phone)}
                  </a>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <PaymentStatusBadge status={booking.payment_status} />
                <FlightStatusBadge status={booking.flight_status} />
              </div>
            </div>

            <dl className="mt-5">
              <Row label="الخدمة">
                {SOURCE_LABEL_AR[booking.source_discriminator] ??
                  booking.source_discriminator}
                {sourceHref ? (
                  <Link
                    href={sourceHref}
                    className="ms-3 text-xs text-gold-light hover:text-gold"
                  >
                    فتح الطلب الأصلي ←
                  </Link>
                ) : null}
              </Row>
              <Row label="المسار">
                <span dir="ltr">{formatBookingRoute(booking)}</span>
              </Row>
              <Row label="المغادرة">
                {formatRiyadhDateTime(booking.departure_scheduled)}
              </Row>
              {booking.return_scheduled ? (
                <Row label="العودة">
                  {formatRiyadhDateTime(booking.return_scheduled)}
                </Row>
              ) : null}
              {booking.passengers_count_snapshot !== null ? (
                <Row label="الركاب">{booking.passengers_count_snapshot}</Row>
              ) : null}
              <Row label="الطائرة">{booking.aircraft_snapshot ?? '—'}</Row>
              <Row label="المشغّل">
                {operatorHref ? (
                  <Link href={operatorHref} className="text-gold-light hover:text-gold">
                    {operatorName ?? '—'}
                  </Link>
                ) : (
                  (operatorName ?? '—')
                )}
                {booking.operator_phone_snapshot ? (
                  <span className="ms-2 text-xs text-ink-muted" dir="ltr">
                    {formatPhone(booking.operator_phone_snapshot)}
                  </span>
                ) : null}
              </Row>
              <Row label="أُنشئ في">{formatRiyadhDateTime(booking.created_at)}</Row>
              {booking.flight_status === 'cancelled' ? (
                <Row label="سبب الإلغاء">
                  {booking.cancellation_reason ?? '—'}
                  {booking.cancelled_at ? (
                    <span className="ms-2 text-xs text-ink-muted">
                      ({formatRiyadhDateTime(booking.cancelled_at)})
                    </span>
                  ) : null}
                </Row>
              ) : null}
            </dl>
          </div>

          <Card title="المبالغ">
            <dl>
              <Row label="السعر الأساسي">{sar(booking.base_amount)}</Row>
              <Row label="الخدمات الإضافية">{sar(booking.addons_amount ?? 0)}</Row>
              {booking.vat_amount !== null ? (
                <Row label="ضريبة القيمة المضافة">{sar(booking.vat_amount)}</Row>
              ) : null}
              <Row label="الإجمالي">{formatSARLabel(booking.total_amount)}</Row>
              {(booking.cashback_redemption_sar ?? 0) > 0 ? (
                <Row label="خصم الكاش باك">
                  − {sar(booking.cashback_redemption_sar)}
                </Row>
              ) : null}
              <Row label="الصافي المستحق">
                <span className="text-gold-light">{sar(netDue)}</span>
              </Row>
              {booking.cashback_earned_sar !== null ? (
                <Row label="كاش باك مكتسب">{sar(booking.cashback_earned_sar)}</Row>
              ) : null}
            </dl>
          </Card>

          {addons.length > 0 ? (
            <Card title={`الخدمات الإضافية (${addons.length})`}>
              <ul className="divide-y divide-border/60">
                {addons.map((a) => (
                  <li
                    key={a.id}
                    className="font-ar flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className={a.status === 'cancelled' ? 'text-ink-muted line-through' : 'text-ink'}>
                      {ADDONS_BY_SUBTYPE.get(a.addon_subtype)?.label_ar ?? a.addon_subtype}
                      {a.quantity > 1 ? ` × ${a.quantity}` : ''}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {ADDON_STATUS_LABEL_AR[a.status] ?? a.status} · {sar(a.total_price)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Card title="الدفع">
            <dl>
              <Row label="الحالة">
                <PaymentStatusBadge status={booking.payment_status} />
              </Row>
              <Row label="الصافي المستحق">{sar(netDue)}</Row>
              {booking.paid_at ? (
                <Row label="تاريخ الدفع">{formatRiyadhDateTime(booking.paid_at)}</Row>
              ) : null}
            </dl>

            {payments.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="font-ar rounded-lg border border-border/60 bg-navy-secondary/40 p-3 text-xs text-ink-secondary"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{PROVIDER_LABEL_AR[p.provider] ?? p.provider}</span>
                      <span>{LEDGER_STATUS_LABEL_AR[p.status] ?? p.status}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-ink-muted">
                      <span>{sar(p.amount)}</span>
                      <span>{formatRiyadhDateTime(p.created_at)}</span>
                    </div>
                    {p.gateway_transaction_id ? (
                      <div className="mt-1 break-all text-ink-muted">
                        المرجع: <span dir="ltr">{p.gateway_transaction_id}</span>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4">
              {canConfirmOffline ? (
                <ConfirmOfflinePaymentForm
                  bookingId={booking.id}
                  bookingNumber={booking.booking_number}
                  netDue={netDue}
                />
              ) : isPaid ? null : bundle.hasActivePaymentAttempt ? (
                <p className="font-ar rounded-md border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  توجد محاولة دفع إلكتروني قائمة لهذا الحجز — تحقّق منها لدى
                  بوابة الدفع قبل تأكيد أي دفع يدوي.
                </p>
              ) : (
                <p className="font-ar text-xs text-ink-muted">
                  لا يمكن تأكيد الدفع يدوياً لهذا الحجز في حالته الحالية.
                </p>
              )}
            </div>
          </Card>

          <Card title="حالة الرحلة">
            <div className="flex items-center gap-2">
              <span className="font-ar text-xs text-ink-muted">الحالية:</span>
              <FlightStatusBadge status={booking.flight_status} />
            </div>
            <div className="mt-4">
              {options.length > 0 ? (
                <FlightStatusForm
                  key={booking.flight_status}
                  bookingId={booking.id}
                  bookingNumber={booking.booking_number}
                  current={booking.flight_status}
                  options={options}
                />
              ) : (
                <p className="font-ar text-xs text-ink-muted">
                  الحالة نهائية — لا توجد انتقالات متاحة.
                </p>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </section>
  );
}
