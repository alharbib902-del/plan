import type { ReviewRow } from '@/lib/reviews/queries';
import { clientsAr } from '@/lib/i18n/clients-ar';

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

function Stars({ rating }: { rating: number }) {
  const safe = Math.max(0, Math.min(5, rating));
  return (
    <span aria-label={`${safe} ${clientsAr.reviewStarSuffix}`} className="text-gold">
      {'★'.repeat(safe)}
      <span className="text-muted">{'★'.repeat(5 - safe)}</span>
    </span>
  );
}

export function ReviewList({
  reviews,
  emptyLabel = clientsAr.meReviewsListEmpty,
}: {
  reviews: ReviewRow[];
  emptyLabel?: string;
}) {
  if (reviews.length === 0) {
    return <p className="text-muted">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-3" dir="rtl">
      {reviews.map((review) => (
        <li key={review.id} className="rounded-lg border border-secondary bg-white p-4">
          <div className="flex items-center justify-between">
            <Stars rating={review.overall_rating} />
            <span className="text-sm text-muted">
              {clientsAr.meReviewsBookingPrefix}{' '}
              {review.bookings?.booking_number ?? review.booking_id.slice(0, 8)}
            </span>
          </div>
          {review.comment ? (
            <p className="mt-2 text-sm text-navy">{review.comment}</p>
          ) : null}
          {review.response ? (
            <div className="mt-3 rounded-md bg-secondary/20 p-3">
              <p className="text-xs font-medium text-navy">{clientsAr.meReviewsOperatorResponse}</p>
              <p className="mt-1 text-sm text-navy">{review.response}</p>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted">{formatDate(review.created_at)}</p>
        </li>
      ))}
    </ul>
  );
}
