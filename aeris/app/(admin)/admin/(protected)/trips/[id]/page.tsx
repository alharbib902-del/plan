import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTripById } from '@/lib/supabase/queries/trips';
import { listOffersByTripUnified } from '@/lib/supabase/queries/unified-offers';
import { listCurrentRoundTargets } from '@/lib/supabase/queries/phase5-targets';
import {
  buildOperatorUrl,
  buildOperatorWhatsAppLink,
} from '@/lib/operator/links';
import { issueOperatorTokenFromTarget } from '@/lib/operator/token';
import { TripDetailCard } from '@/components/admin/trip-detail-card';
import {
  DispatchPanelV2,
  type DispatchPanelV2Props,
} from '@/components/admin/dispatch-panel-v2';
import { UnifiedOfferCard } from '@/components/admin/unified-offer-card';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'تفاصيل الرحلة',
  robots: { index: false, follow: false },
};

interface TripDetailPageProps {
  params: { id: string };
}

export default async function TripDetailPage({ params }: TripDetailPageProps) {
  const trip = await getTripById(params.id);
  if (!trip) {
    notFound();
  }

  // Phase 5 reads, in parallel:
  //   - unified offers list (Phase 4 + Phase 5 merged + tagged)
  //   - current round's still-pending targets (refresh-durable
  //     source for the operator URL cards — see acceptance #14a)
  const [offers, currentTargets] = await Promise.all([
    listOffersByTripUnified(trip.id),
    listCurrentRoundTargets(trip.id),
  ]);

  // Sort offers: pending first (so admin focuses on actionable
  // items), then by total_price_sar ascending within each
  // group, then by created_at DESC as tiebreaker. Spec
  // acceptance #17 (price-ascending default).
  const sortedOffers = [...offers].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    if (a.total_price_sar !== b.total_price_sar) {
      return a.total_price_sar - b.total_price_sar;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });

  const isClosed = trip.status === 'booked' || trip.status === 'cancelled';
  const tripIsOffered = trip.status === 'offered';

  // Rebuild current-round dispatch URLs from the persisted target
  // rows. Uses issueOperatorTokenFromTarget (PR 2) which derives
  // issued_at from target.sent_at exclusively — so the URLs
  // reproduce byte-identically across page renders even if the
  // original Server Action's response was lost.
  const currentDispatches: DispatchPanelV2Props['currentDispatches'] =
    currentTargets.map((target) => {
      const issued = issueOperatorTokenFromTarget({
        trip_request_id: target.trip_request_id,
        id: target.id,
        nonce: target.nonce,
        sent_at: target.sent_at,
        expires_at: target.expires_at,
      });
      const operatorUrl = buildOperatorUrl(issued.token);
      return {
        target_id: target.id,
        target_phone: target.target_phone,
        operator_url: operatorUrl,
        whatsapp_link: buildOperatorWhatsAppLink(target.target_phone, operatorUrl),
        sent_at: target.sent_at,
        expires_at: target.expires_at,
      };
    });

  return (
    <section>
      <Link
        href="/admin/trips"
        className="font-ar group inline-flex items-center gap-2 text-sm text-ink-muted transition-colors hover:text-gold"
      >
        <ArrowLeft
          className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:rotate-180"
          aria-hidden
        />
        العودة لقائمة الرحلات
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr,1fr] lg:items-start">
        <div className="space-y-6">
          <TripDetailCard trip={trip} />

          <div className="rounded-xl border border-border bg-navy-card/40 p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-ar text-base font-medium text-ink">
                العروض المستلمة ({sortedOffers.length})
              </h3>
            </div>
            {sortedOffers.length === 0 ? (
              <p className="font-ar mt-4 rounded-md border border-dashed border-border bg-navy-secondary/30 p-6 text-center text-sm text-ink-muted">
                لم يصل أي عرض من المشغّلين بعد.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {sortedOffers.map((offer) => (
                  <UnifiedOfferCard
                    key={`${offer.source}:${offer.id}`}
                    offer={offer}
                    tripIsOffered={tripIsOffered}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-navy-card/40 p-5">
            <h3 className="font-ar text-base font-medium text-ink">
              إرسال للمشغّلين
            </h3>
            <DispatchPanelV2
              tripRequestId={trip.id}
              isClosed={isClosed}
              currentDispatches={currentDispatches}
            />
          </div>
        </aside>
      </div>
    </section>
  );
}
