'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { reviewSchema } from '@/lib/reviews/validators';
import { clientsAr } from '@/lib/i18n/clients-ar';

export type ReviewActionState = {
  ok: boolean;
  message: string;
  errors?: Record<string, string[]>;
};

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

export async function createReviewAction(
  _prevState: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  // Redirects to /login on failure.
  const session = await requireClientSession();

  const parsed = reviewSchema.safeParse({
    booking_id: formData.get('booking_id'),
    overall_rating: formData.get('overall_rating'),
    aircraft_rating: formData.get('aircraft_rating'),
    crew_rating: formData.get('crew_rating'),
    service_rating: formData.get('service_rating'),
    comment: formData.get('comment'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: clientsAr.reviewActionInvalid,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const looseClient = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await looseClient.rpc('create_review', {
    p_booking_id: parsed.data.booking_id,
    p_client_id: session.client_id,
    p_overall_rating: parsed.data.overall_rating,
    p_aircraft_rating: parsed.data.aircraft_rating,
    p_crew_rating: parsed.data.crew_rating,
    p_service_rating: parsed.data.service_rating,
    p_comment: parsed.data.comment || null,
  });

  if (error) {
    console.error('[reviews] create_review rpc error', error);
    return { ok: false, message: clientsAr.reviewActionError };
  }

  // The RPC returns NULL when the booking is not owned by the client,
  // is not completed, or has already been reviewed.
  if (!data) {
    return {
      ok: false,
      message: clientsAr.reviewActionNotEligible,
    };
  }

  revalidatePath('/me/reviews');
  return { ok: true, message: clientsAr.reviewActionSuccess };
}
