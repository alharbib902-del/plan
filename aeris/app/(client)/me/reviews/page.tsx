import 'server-only';

import { requireClientSession } from '@/lib/clients/auth';
import { getReviewsForClient, getReviewableBookings } from '@/lib/reviews/queries';
import { ReviewForm } from '@/components/reviews/review-form';
import { ReviewList } from '@/components/reviews/review-list';
import { clientsAr } from '@/lib/i18n/clients-ar';

export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-SA', {
      timeZone: 'Asia/Riyadh',
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default async function MyReviewsPage() {
  const session = await requireClientSession();

  const [reviews, reviewable] = await Promise.all([
    getReviewsForClient(session.client_id),
    getReviewableBookings(session.client_id),
  ]);

  return (
    <div dir="rtl" className="space-y-8">
      <h1 className="text-2xl font-semibold text-navy">{clientsAr.meReviewsTitle}</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-navy">{clientsAr.meReviewsAwaitingTitle}</h2>
        {reviewable.length === 0 ? (
          <p className="text-muted">{clientsAr.meReviewsAwaitingEmpty}</p>
        ) : (
          <ul className="space-y-4">
            {reviewable.map((booking) => (
              <li
                key={booking.id}
                className="rounded-lg border border-secondary bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium text-navy">
                    {clientsAr.meReviewsBookingPrefix} {booking.booking_number}
                  </span>
                  <span className="text-sm text-muted">
                    {formatDate(booking.departure_scheduled)}
                  </span>
                </div>
                <ReviewForm bookingId={booking.id} label={clientsAr.meReviewsRateCta} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-navy">{clientsAr.meReviewsPastTitle}</h2>
        <ReviewList reviews={reviews} emptyLabel={clientsAr.meReviewsPastEmpty} />
      </section>
    </div>
  );
}
