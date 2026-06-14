'use server';

import { revalidatePath } from 'next/cache';

import { requireClientSession } from '@/lib/clients/auth';
import {
  runCancelMyTripRequest,
  runClientAcceptOffer,
  runClientDeclineOffer,
  runCreateAuthenticatedTripRequest,
  type CancelMyTripRequestResult,
  type ClientAcceptOfferResult,
  type ClientDeclineOfferResult,
  type ClientTripActionFailure,
  type CreateAuthenticatedTripRequestResult,
} from '@/lib/clients/core/trip-requests-core';

export type {
  CancelMyTripRequestResult,
  ClientAcceptOfferResult,
  ClientDeclineOfferResult,
  ClientTripActionFailure,
  CreateAuthenticatedTripRequestResult,
};

function isPortalDisabled(): boolean {
  return process.env.ENABLE_CLIENT_PORTAL !== 'true';
}

export async function createAuthenticatedTripRequest(input: Parameters<
  typeof runCreateAuthenticatedTripRequest
>[1]): Promise<CreateAuthenticatedTripRequestResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  const result = await runCreateAuthenticatedTripRequest(
    session.client_id,
    input
  );

  if (result.ok) {
    revalidatePath('/me/requests');
    revalidatePath('/me/charter');
  }

  return result;
}

export async function cancelMyTripRequest(input: Parameters<
  typeof runCancelMyTripRequest
>[1]): Promise<CancelMyTripRequestResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  const result = await runCancelMyTripRequest(session.client_id, input);

  if (result.ok) {
    revalidatePath('/me/requests');
    revalidatePath(`/me/requests/${result.trip_request_id}`);
  }

  return result;
}

export async function clientAcceptOffer(input: Parameters<
  typeof runClientAcceptOffer
>[1]): Promise<ClientAcceptOfferResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  const result = await runClientAcceptOffer(session.client_id, input);

  if (result.ok) {
    revalidatePath('/me/requests');
    revalidatePath(`/me/requests/${result.trip_request_id}`);
    revalidatePath('/me/bookings');
  }

  return result;
}

export async function clientDeclineOffer(input: Parameters<
  typeof runClientDeclineOffer
>[1]): Promise<ClientDeclineOfferResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  const result = await runClientDeclineOffer(session.client_id, input);

  if (result.ok) {
    revalidatePath('/me/requests');
    revalidatePath(`/me/requests/${result.trip_request_id}`);
  }

  return result;
}
