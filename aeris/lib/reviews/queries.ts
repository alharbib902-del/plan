import 'server-only';

import { createLooseClient } from '@/lib/supabase/loose-query';

export type ReviewRow = {
  id: string;
  booking_id: string;
  client_id: string;
  operator_id: string;
  aircraft_id: string | null;
  overall_rating: number;
  aircraft_rating: number | null;
  crew_rating: number | null;
  service_rating: number | null;
  comment: string | null;
  is_published: boolean;
  response: string | null;
  response_at: string | null;
  created_at: string;
};

export type ReviewableBooking = {
  id: string;
  booking_number: string;
  total_amount: number;
  departure_scheduled: string;
  flight_status: string;
};

const REVIEW_COLUMNS =
  'id, booking_id, client_id, operator_id, aircraft_id, overall_rating, aircraft_rating, crew_rating, service_rating, comment, is_published, response, response_at, created_at';

/** Reviews written by a client (by users.id), newest first. */
export async function getReviewsForClient(clientId: string): Promise<ReviewRow[]> {
  const { data, error } = await createLooseClient()
    .from('reviews')
    .select(REVIEW_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as ReviewRow[];
}

/**
 * Completed bookings owned by the client that have NOT been reviewed yet —
 * the "rate your trip" call-to-action source.
 */
export async function getReviewableBookings(
  clientId: string
): Promise<ReviewableBooking[]> {
  const client = createLooseClient();

  const { data: bookings, error: bookingsError } = await client
    .from('bookings')
    .select('id, booking_number, total_amount, departure_scheduled, flight_status')
    .eq('client_id', clientId)
    .order('departure_scheduled', { ascending: false });
  if (bookingsError) {
    throw new Error(bookingsError.message);
  }

  const completed = ((bookings ?? []) as ReviewableBooking[]).filter(
    (b) => b.flight_status === 'completed'
  );
  if (completed.length === 0) {
    return [];
  }

  const { data: existing, error: reviewsError } = await client
    .from('reviews')
    .select('booking_id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (reviewsError) {
    throw new Error(reviewsError.message);
  }

  const reviewed = new Set(
    ((existing ?? []) as { booking_id: string }[]).map((r) => r.booking_id)
  );
  return completed.filter((b) => !reviewed.has(b.id));
}

/** All reviews (admin view), newest first. */
export async function getAllReviews(): Promise<ReviewRow[]> {
  const { data, error } = await createLooseClient()
    .from('reviews')
    .select(REVIEW_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as ReviewRow[];
}
