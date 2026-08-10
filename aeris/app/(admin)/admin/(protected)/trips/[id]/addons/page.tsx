import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { getTripById } from '@/lib/supabase/queries/trips';
import {
  getBookingByTripId,
  listBookingAddons,
  resolveAddonsGate,
  type AddonsGateCase,
} from '@/lib/supabase/queries/bookings';
import { ADDONS_CATALOG, ADDONS_BY_TYPE } from '@/lib/addons/catalog';
import { t } from '@/lib/i18n/operator';
import type { TripPreferences } from '@/lib/validators/trip-preferences';
import { AddonsAttachForm } from '@/components/admin/addons-attach-form';
import { AddonsSuggestionBanner } from '@/components/admin/addons-suggestion-banner';
import { AttachedAddonsTable } from '@/components/admin/attached-addons-table';
import { LegacyBookingBackfillButton } from '@/components/admin/legacy-booking-backfill-button';
import { IssueCheckoutLinkButton } from '@/components/admin/issue-checkout-link-button';
import { MarkPaidButton } from '@/components/admin/mark-paid-button';
import {
  offlineNetAmount,
  resolveMarkPaidGate,
} from '@/lib/payments/offline-settlement';
import type { BookingAddonRow, BookingRow } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'الخدمات الإضافية',
  robots: { index: false, follow: false },
};

interface AddonsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Phase 6.2 PR 2b: admin add-ons surface.
 *
 * Spec S4 + S4.1 — three-case gate:
 *
 *   - Case A (`pre_accept`)         → tab disabled with
 *                                     copy "بعد قبول العرض...".
 *   - Case B (`booked_with_record`) → catalog + attached
 *                                     rows + suggestion
 *                                     banner + issue-checkout-
 *                                     link button.
 *   - Case C (`booked_no_record`)   → "إنشاء سجل الحجز"
 *                                     button (calls
 *                                     backfillBookingFromAcceptedOffer).
 *   - `closed`                       → trip cancelled, read-only.
 *
 * The page itself does NO mutation — every state change goes
 * through the four admin Server Actions in
 * `app/(admin)/admin/actions/booking-addons.ts` (which are
 * thin wrappers around PR 2a's SECURITY DEFINER RPCs).
 */
export default async function AddonsPage({ params }: AddonsPageProps) {
  const { id } = await params;
  const trip = await getTripById(id);
  if (!trip) {
    notFound();
  }

  const booking = await getBookingByTripId(trip.id);
  const gate = resolveAddonsGate(trip.status, booking);

  return (
    <section>
      <BackLink tripId={trip.id} />

      <header className="mt-6 flex flex-col gap-2">
        <div className="font-mono text-sm text-gold-light">
          {trip.request_number}
        </div>
        <h2 className="font-ar text-xl text-ink">{t('admin_addons_tab_label', 'ar')}</h2>
      </header>

      <div className="mt-8">
        <CaseRouter
          gate={gate}
          tripId={trip.id}
          booking={booking}
          preferences={trip.preferences ?? null}
        />
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────
// Case routing — switch on the resolved gate
// ────────────────────────────────────────────────────────────

async function CaseRouter({
  gate,
  tripId,
  booking,
  preferences,
}: {
  gate: AddonsGateCase;
  tripId: string;
  booking: BookingRow | null;
  preferences: TripPreferences | null;
}) {
  if (gate === 'pre_accept') {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-6">
        <p className="font-ar text-sm text-ink-muted">
          {t('admin_addons_pre_accept_message', 'ar')}
        </p>
      </div>
    );
  }

  if (gate === 'closed') {
    return (
      <div className="rounded-xl border border-dashed border-border bg-navy-card/30 p-6">
        <p className="font-ar text-sm text-ink-muted">
          {/* Trip cancelled — read-only. Reuse the pre-accept
              copy as a generic disabled state. */}
          {t('admin_addons_pre_accept_message', 'ar')}
        </p>
      </div>
    );
  }

  if (gate === 'booked_no_record') {
    return (
      <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-6">
        <p className="font-ar text-sm text-amber-100">
          {t('admin_addons_legacy_no_booking_message', 'ar')}
        </p>
        <div className="mt-4">
          <LegacyBookingBackfillButton tripId={tripId} />
        </div>
      </div>
    );
  }

  // booked_with_record — happy path. `booking` is guaranteed
  // non-null by the gate.
  if (!booking) {
    // Defensive — should never happen.
    return null;
  }

  const addons = await listBookingAddons(booking.id);
  return (
    <CaseBView
      tripId={tripId}
      booking={booking}
      passengersCount={booking.passengers_count_snapshot ?? 1}
      preferences={preferences}
      addons={addons}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Case B view — catalog + attached + suggestion banner
// ────────────────────────────────────────────────────────────

function CaseBView({
  tripId,
  booking,
  passengersCount,
  preferences,
  addons,
}: {
  tripId: string;
  booking: BookingRow;
  passengersCount: number;
  preferences: TripPreferences | null;
  addons: BookingAddonRow[];
}) {
  const bookingId = booking.id;
  return (
    <div className="space-y-8">
      {/* Suggestion banner — preferences-driven highlights */}
      {preferences && <AddonsSuggestionBanner preferences={preferences} />}

      {/* Attached add-ons table */}
      <AttachedAddonsTable tripId={tripId} addons={addons} />

      {/* Catalog browse — group by addon_type */}
      <div className="rounded-xl border border-border bg-navy-card/30 p-6">
        <h3 className="font-ar text-base font-medium text-ink">
          {t('admin_addons_catalog_heading', 'ar')}
        </h3>
        <div className="mt-4 space-y-6">
          {(['ground_transfer', 'crew', 'catering', 'special'] as const).map(
            (type) => {
              const entries = ADDONS_BY_TYPE.get(type) ?? [];
              if (entries.length === 0) return null;
              return (
                <div key={type}>
                  <h4 className="font-ar text-sm font-medium text-gold-light">
                    {t(`addon_type_${type}` as 'addon_type_ground_transfer', 'ar')}
                  </h4>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {entries.map((entry) => (
                      <AddonsAttachForm
                        key={entry.subtype}
                        tripId={tripId}
                        entry={entry}
                        passengersCount={passengersCount}
                        preferences={preferences}
                      />
                    ))}
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* Issue checkout link — admin button (founder mints +
          dispatches token after attaching add-ons). */}
      <div className="rounded-xl border border-border bg-navy-card/30 p-6">
        <IssueCheckoutLinkButton bookingId={bookingId} />
      </div>

      {/* Offline settlement — status badge + "confirm payment received".
          Money is collected offline today; this is where the founder
          records it (migration 20260702000001). */}
      <PaymentSection tripId={tripId} booking={booking} />

      {/* Catalog count footer for the parity test's smoke ref */}
      <p className="font-ar text-xs text-ink-muted/60">
        كتالوج الخدمات يحوي {ADDONS_CATALOG.length} خدمة (Phase 6.2).
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Payment section — offline settlement (Case B)
// ────────────────────────────────────────────────────────────

const PAYMENT_STATUS_KEYS = {
  pending: 'admin_payment_status_pending',
  pending_offline: 'admin_payment_status_pending_offline',
  paid: 'admin_payment_status_paid',
  refunded: 'admin_payment_status_refunded',
} as const;

function PaymentSection({
  tripId,
  booking,
}: {
  tripId: string;
  booking: BookingRow;
}) {
  // paid_at / cashback_redemption_sar are live columns that the
  // hand-maintained BookingRow doesn't carry yet (loose-client pattern);
  // getBookingByTripId selects '*' so they're present at runtime.
  const pay = booking as unknown as {
    paid_at?: string | null;
    cashback_redemption_sar?: number | null;
  };
  const gate = resolveMarkPaidGate({
    payment_status: booking.payment_status,
    paid_at: pay.paid_at ?? null,
  });
  const statusKey =
    PAYMENT_STATUS_KEYS[booking.payment_status] ??
    'admin_payment_status_pending';
  const badgeTone =
    gate === 'already_paid'
      ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
      : gate === 'refunded'
        ? 'border-red-400/40 bg-red-500/10 text-red-200'
        : 'border-amber-400/40 bg-amber-500/10 text-amber-200';

  return (
    <div className="rounded-xl border border-border bg-navy-card/30 p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-ar text-base font-medium text-ink">
          {t('admin_payment_section_heading', 'ar')}
        </h3>
        <span
          className={`font-ar rounded-full border px-3 py-1 text-xs ${badgeTone}`}
        >
          {t(statusKey, 'ar')}
        </span>
      </div>

      {gate === 'payable' && (
        <div className="mt-4">
          <MarkPaidButton
            bookingId={booking.id}
            tripId={tripId}
            netAmount={offlineNetAmount({
              total_amount: booking.total_amount,
              cashback_redemption_sar: pay.cashback_redemption_sar ?? null,
            })}
          />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Back link to trip detail
// ────────────────────────────────────────────────────────────

function BackLink({ tripId }: { tripId: string }) {
  return (
    <Link
      href={`/admin/trips/${tripId}`}
      className="font-ar group inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-gold"
    >
      <ArrowLeft
        className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180"
        aria-hidden
      />
      العودة لتفاصيل الرحلة
    </Link>
  );
}
