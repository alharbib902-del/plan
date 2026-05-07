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
import type { BookingAddonRow } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'الخدمات الإضافية',
  robots: { index: false, follow: false },
};

interface AddonsPageProps {
  params: { id: string };
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
  const trip = await getTripById(params.id);
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
  booking: { id: string; passengers_count_snapshot: number | null } | null;
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
      bookingId={booking.id}
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
  bookingId,
  passengersCount,
  preferences,
  addons,
}: {
  tripId: string;
  bookingId: string;
  passengersCount: number;
  preferences: TripPreferences | null;
  addons: BookingAddonRow[];
}) {
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

      {/* Catalog count footer for the parity test's smoke ref */}
      <p className="font-ar text-xs text-ink-muted/60">
        كتالوج الخدمات يحوي {ADDONS_CATALOG.length} خدمة (Phase 6.2).
      </p>
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
