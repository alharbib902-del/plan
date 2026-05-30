import type { ReviewRow } from '@/lib/reviews/queries';

function Stars({ rating }: { rating: number }) {
  const safe = Math.max(0, Math.min(5, rating));
  return (
    <span aria-label={`${safe} من 5`} className="text-gold">
      {'★'.repeat(safe)}
      <span className="text-muted">{'★'.repeat(5 - safe)}</span>
    </span>
  );
}

export function ReviewList({
  reviews,
  emptyLabel = 'لا توجد تقييمات بعد.',
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
              حجز #{review.booking_id.slice(0, 8)}
            </span>
          </div>
          {review.comment ? (
            <p className="mt-2 text-sm text-navy">{review.comment}</p>
          ) : null}
          {review.response ? (
            <div className="mt-3 rounded-md bg-secondary/20 p-3">
              <p className="text-xs font-medium text-navy">ردّ المشغّل</p>
              <p className="mt-1 text-sm text-navy">{review.response}</p>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            {new Date(review.created_at).toLocaleDateString('ar')}
          </p>
        </li>
      ))}
    </ul>
  );
}
