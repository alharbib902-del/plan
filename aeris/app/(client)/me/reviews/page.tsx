import 'server-only';

import { requireClientSession } from '@/lib/clients/auth';
import { getReviewsForClient, getReviewableBookings } from '@/lib/reviews/queries';
import { ReviewForm } from '@/components/reviews/review-form';
import { ReviewList } from '@/components/reviews/review-list';

export const dynamic = 'force-dynamic';

export default async function MyReviewsPage() {
  const session = await requireClientSession();

  const [reviews, reviewable] = await Promise.all([
    getReviewsForClient(session.client_id),
    getReviewableBookings(session.client_id),
  ]);

  return (
    <div dir="rtl" className="space-y-8">
      <h1 className="text-2xl font-semibold text-navy">تقييماتي</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-navy">رحلات بانتظار تقييمك</h2>
        {reviewable.length === 0 ? (
          <p className="text-muted">لا توجد رحلات مكتملة بانتظار التقييم.</p>
        ) : (
          <ul className="space-y-4">
            {reviewable.map((booking) => (
              <li
                key={booking.id}
                className="rounded-lg border border-secondary bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium text-navy">
                    حجز {booking.booking_number}
                  </span>
                  <span className="text-sm text-muted">
                    {new Date(booking.departure_scheduled).toLocaleDateString('ar')}
                  </span>
                </div>
                <ReviewForm bookingId={booking.id} label="قيّم رحلتك" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-navy">تقييماتك السابقة</h2>
        <ReviewList reviews={reviews} emptyLabel="لم تكتب أي تقييم بعد." />
      </section>
    </div>
  );
}
