import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTripById } from '@/lib/supabase/queries/trips';
import { listOffersByTrip } from '@/lib/supabase/queries/phase4-offers';
import { TripDetailCard } from '@/components/admin/trip-detail-card';
import { DispatchForm } from '@/components/admin/dispatch-form';
import { Phase4OfferCard } from '@/components/admin/phase4-offer-card';

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

  const offers = await listOffersByTrip(trip.id);

  const isClosed = trip.status === 'booked' || trip.status === 'cancelled';
  const dispatchExpired =
    trip.dispatch_expires_at !== null &&
    Date.parse(trip.dispatch_expires_at) <= Date.now();

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
                العروض المستلمة ({offers.length})
              </h3>
            </div>
            {offers.length === 0 ? (
              <p className="font-ar mt-4 rounded-md border border-dashed border-border bg-navy-secondary/30 p-6 text-center text-sm text-ink-muted">
                لم يصل أي عرض من المشغّلين بعد.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {offers.map((offer) => (
                  <Phase4OfferCard key={offer.id} offer={offer} />
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-xl border border-border bg-navy-card/40 p-5">
            <h3 className="font-ar text-base font-medium text-ink">
              إرسال للمشغّل
            </h3>
            {isClosed ? (
              <p className="font-ar mt-3 text-xs text-ink-muted">
                هذه الرحلة مغلقة (محجوزة أو ملغاة) ولا يمكن إعادة إرسالها.
              </p>
            ) : (
              <>
                <p className="font-ar mt-1 text-xs text-ink-muted">
                  أنشئ رابطًا موقّعًا صالحًا لمدة 72 ساعة، ثم انسخه إلى واتساب
                  المشغّل يدويًا.
                </p>
                {dispatchExpired && trip.dispatch_nonce && (
                  <p className="font-ar mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                    انتهت صلاحية الرابط السابق. أعِد الإرسال لتوليد رابط جديد.
                  </p>
                )}
                <div className="mt-4">
                  <DispatchForm
                    tripRequestId={trip.id}
                    initialOperatorPhone={trip.dispatch_target_phone}
                    initialExpiresAt={trip.dispatch_expires_at}
                  />
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
