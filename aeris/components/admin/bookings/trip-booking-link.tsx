import Link from 'next/link';

import { getBookingRefForTrip } from '@/lib/admin/bookings/queries';

/** Header link from an admin trip to the booking it produced (if any). */
export async function TripBookingLink({ tripId }: { tripId: string }) {
  const booking = await getBookingRefForTrip(tripId);
  if (!booking) return null;
  return (
    <Link
      href={`/admin/bookings/${booking.id}`}
      className="font-ar inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs text-gold-light transition-colors hover:bg-gold/20"
    >
      الحجز <span dir="ltr">{booking.booking_number}</span> ←
    </Link>
  );
}
