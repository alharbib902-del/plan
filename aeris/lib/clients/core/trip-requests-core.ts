import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { fireAndForgetTripDispatch } from '@/lib/automation/trip-dispatch-fire';
import { redeemCashbackIfRequested } from '@/lib/privilege/redeem-helper';
import {
  createTripRequestSchema,
  cancelTripRequestSchema,
  acceptOfferSchema,
  declineOfferSchema,
  type CreateTripRequestInput,
  type CancelTripRequestInput,
  type AcceptOfferInput,
  type DeclineOfferInput,
} from '@/lib/validators/clients';

export type ClientTripActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

export type CreateAuthenticatedTripRequestResult =
  | { ok: true; trip_request_id: string; request_number: string }
  | ClientTripActionFailure;

export type CancelMyTripRequestResult =
  | { ok: true; trip_request_id: string }
  | ClientTripActionFailure;

export type ClientAcceptOfferResult =
  | {
      ok: true;
      trip_request_id: string;
      booking_id: string | null;
      cashback_redemption?:
        | { ok: true; redeemed_sar: number; new_balance_sar: number }
        | { ok: false; error: string };
    }
  | ClientTripActionFailure;

export type ClientDeclineOfferResult =
  | { ok: true; offer_id: string; trip_request_id: string }
  | ClientTripActionFailure;

function fieldErrorsFromZod(
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.');
    if (path) out[path] = issue.message;
  }
  return out;
}

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

function looseClient(): LooseRpcClient {
  return createAdminClient() as unknown as LooseRpcClient;
}

function isAutoDistributionEnabled(): boolean {
  return process.env.ENABLE_TRIP_AUTO_DISTRIBUTION === 'true';
}

export async function runCreateAuthenticatedTripRequest(
  clientId: string,
  input: CreateTripRequestInput
): Promise<CreateAuthenticatedTripRequestResult> {
  const parsed = createTripRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc(
    'create_authenticated_trip_request',
    {
      p_client_id: clientId,
      p_trip_type: 'charter',
      p_legs: parsed.data.legs,
      p_departure_iata: parsed.data.departure_iata.toUpperCase(),
      p_arrival_iata: parsed.data.arrival_iata.toUpperCase(),
      p_departure_date: parsed.data.departure_date,
      p_return_date: parsed.data.return_date ?? null,
      p_passengers: parsed.data.passengers,
      p_aircraft_pref: parsed.data.aircraft_pref ?? null,
      p_special_requests: parsed.data.special_requests ?? null,
    }
  );

  if (error) {
    console.error(
      '[trip-requests-core.runCreateAuthenticatedTripRequest] rpc error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; trip_request_id: string; request_number: string }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  if (isAutoDistributionEnabled()) {
    fireAndForgetTripDispatch(result.trip_request_id);
  }

  return {
    ok: true,
    trip_request_id: result.trip_request_id,
    request_number: result.request_number,
  };
}

export async function runCancelMyTripRequest(
  clientId: string,
  input: CancelTripRequestInput
): Promise<CancelMyTripRequestResult> {
  const parsed = cancelTripRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('trip_requests')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.trip_request_id)
    .eq('client_id', clientId)
    .in('status', ['pending', 'distributed', 'offered'])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(
      '[trip-requests-core.runCancelMyTripRequest] update error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (!data) return { ok: false, error: 'cancel_not_allowed' };

  return { ok: true, trip_request_id: parsed.data.trip_request_id };
}

export async function runClientAcceptOffer(
  clientId: string,
  input: AcceptOfferInput
): Promise<ClientAcceptOfferResult> {
  const parsed = acceptOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const admin = createAdminClient();
  const offerTable =
    parsed.data.source === 'phase4'
      ? 'phase4_operator_offers'
      : 'phase5_operator_offers';

  const { data: offerRow, error: offerErr } = await admin
    .from(offerTable)
    .select('trip_request_id')
    .eq('id', parsed.data.offer_id)
    .maybeSingle();

  if (offerErr) {
    console.error(
      '[trip-requests-core.runClientAcceptOffer] offer lookup error',
      offerErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (!offerRow) return { ok: false, error: 'accept_failed' };

  const tripRequestId = (offerRow as { trip_request_id: string })
    .trip_request_id;
  const { data: tripRow, error: tripErr } = await admin
    .from('trip_requests')
    .select('client_id')
    .eq('id', tripRequestId)
    .maybeSingle();

  if (tripErr) {
    console.error(
      '[trip-requests-core.runClientAcceptOffer] trip lookup error',
      tripErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (
    !tripRow ||
    (tripRow as { client_id: string | null }).client_id !== clientId
  ) {
    return { ok: false, error: 'accept_failed' };
  }

  const loose = looseClient();
  const { data, error } = await loose.rpc('accept_offer', {
    p_source: parsed.data.source,
    p_offer_id: parsed.data.offer_id,
  });

  if (error) {
    console.error(
      '[trip-requests-core.runClientAcceptOffer] rpc error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; trip_request_id: string; booking_id?: string | null }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  const redeem =
    result.booking_id && parsed.data.cashback_redemption_sar
      ? await redeemCashbackIfRequested({
          client_id: clientId,
          booking_id: result.booking_id,
          cashback_redemption_sar: parsed.data.cashback_redemption_sar,
        })
      : null;

  return {
    ok: true,
    trip_request_id: result.trip_request_id,
    booking_id: result.booking_id ?? null,
    ...(redeem
      ? {
          cashback_redemption: redeem.ok
            ? {
                ok: true as const,
                redeemed_sar: redeem.redeemed_sar,
                new_balance_sar: redeem.new_balance_sar,
              }
            : { ok: false as const, error: redeem.error },
        }
      : {}),
  };
}

export async function runClientDeclineOffer(
  clientId: string,
  input: DeclineOfferInput
): Promise<ClientDeclineOfferResult> {
  const parsed = declineOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const admin = createAdminClient();
  const offerTable =
    parsed.data.source === 'phase4'
      ? 'phase4_operator_offers'
      : 'phase5_operator_offers';

  const { data: ownerRow, error: ownerErr } = await admin
    .from(offerTable)
    .select(
      'id, trip_request_id, trip_requests!inner(client_id, status)'
    )
    .eq('id', parsed.data.offer_id)
    .maybeSingle();

  if (ownerErr) {
    console.error(
      '[trip-requests-core.runClientDeclineOffer] owner lookup error',
      ownerErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  type OwnerRow = {
    id: string;
    trip_request_id: string;
    trip_requests: { client_id: string | null; status: string };
  };
  const owner = ownerRow as OwnerRow | null;

  if (
    !owner ||
    owner.trip_requests.client_id !== clientId ||
    !['distributed', 'offered'].includes(owner.trip_requests.status)
  ) {
    return { ok: false, error: 'decline_not_allowed' };
  }

  const { data: updated, error: updateErr } = await admin
    .from(offerTable)
    .update({
      status: 'rejected',
      decided_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.offer_id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (updateErr) {
    console.error(
      '[trip-requests-core.runClientDeclineOffer] update error',
      updateErr
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (!updated) return { ok: false, error: 'decline_not_allowed' };

  return {
    ok: true,
    offer_id: parsed.data.offer_id,
    trip_request_id: owner.trip_request_id,
  };
}
