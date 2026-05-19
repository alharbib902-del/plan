'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requireClientSession } from '@/lib/clients/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { medevacRequestAuthedSchema } from '@/lib/medevac/validators/medevac-request';
import { redeemCashbackIfRequested } from '@/lib/privilege/redeem-helper';
import {
  acceptOfferSchema,
  declineOfferSchema,
  cancelRequestSchema,
} from '@/lib/medevac/validators/medevac-actions';
import { subscribeShieldSchema } from '@/lib/medevac/validators/medevac-subscription';
import {
  isUseSubscriptionTruthy,
  shieldRoutingSchema,
} from '@/lib/medevac/shield-routing';

/**
 * Phase 12 PR 2 — client-side Server Actions for the medevac
 * surface. 5 actions total:
 *
 *   1. submitMedevacRequestAuthed → §4.2 (out-of-pocket) OR
 *      §4.7 consume_aeris_shield_event (J5 covered path)
 *      — the routing branch lives HERE (Round 1 PR #76 P1 #1
 *      fix moved it from the RPC layer; §4.2 hard-rejects the
 *      `use_subscription=true` payload to prevent silent
 *      misrouting). The Shield path requires
 *      subscription_id + patient_member_name + patient_member_dob
 *      in addition to the standard request payload.
 *
 *   2. acceptMyMedevacOffer → §4.4 client path
 *   3. declineMyMedevacOffer → §4.5 client path
 *   4. cancelMyMedevacRequest → §4.6 client path
 *   5. subscribeToAerisShield → §4.8 (returns pending_payment;
 *      admin activates via medevac-admin.ts)
 *
 * Auth: every action calls requireClientSession() BEFORE any
 * validation or write. Session resolves to a clients.id; the
 * RPCs use that as p_actor_client_id (client path) so the
 * authorization gates fire DB-side too.
 *
 * Flag gate: every action checks ENABLE_MEDEVAC === 'true'
 * before touching the RPC layer (fail-closed).
 */

export type MedevacClientsActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isMedevacDisabled(): boolean {
  return process.env.ENABLE_MEDEVAC !== 'true';
}

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

function clientIp(): string | null {
  try {
    const h = headers();
    const xf = h.get('x-forwarded-for');
    if (xf) return xf.split(',')[0]!.trim();
    const xr = h.get('x-real-ip');
    if (xr) return xr.trim();
    return null;
  } catch {
    return null;
  }
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

// ============================================================
// 1. submitMedevacRequestAuthed
//
// Round 1 PR #76 P1 #1 fix — branches HERE (TS layer), NOT
// inside §4.2 RPC. §4.2 hard-rejects use_subscription=true
// with `use_subscription_must_route_to_shield_rpc` so silent
// misrouting is impossible.
//
// Branch logic:
//   - If payload.use_subscription is truthy → §4.7
//     consume_aeris_shield_event (Shield covered path,
//     requires subscription_id + patient_member_name + dob)
//   - Otherwise → §4.2 create_medevac_request_authenticated
//     (out-of-pocket, normal operator-quote flow)
// ============================================================

export type SubmitMedevacRequestAuthedResult =
  | {
      ok: true;
      medevac_request_id: string;
      medevac_request_number: string;
      booking_id?: string;
      shield_consumed?: boolean;
      covered_events_remaining?: number;
    }
  | MedevacClientsActionFailure;

export async function submitMedevacRequestAuthed(
  input: unknown
): Promise<SubmitMedevacRequestAuthedResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  // Probe the routing discriminator first. A truthy
  // use_subscription means the caller intends the J5 covered
  // path; anything else (false/undefined/'no'/0) means
  // out-of-pocket. The isUseSubscriptionTruthy helper is
  // extracted to lib/medevac/shield-routing.ts so the
  // branching logic is testable in isolation.
  const rawObj = (input ?? {}) as Record<string, unknown>;
  const useSubscription = isUseSubscriptionTruthy(
    rawObj['use_subscription']
  );

  if (useSubscription) {
    // J5 covered branch — §4.7 consume_aeris_shield_event.
    const shieldParsed = shieldRoutingSchema.safeParse(input);
    if (!shieldParsed.success) {
      return {
        ok: false,
        error: 'validation_failed',
        field_errors: fieldErrorsFromZod(shieldParsed.error.issues),
      };
    }
    // Validate the base request fields too (severity, service_level,
    // route, value, contact_*) using the authed schema. We strip
    // the shield-only fields before validation so the authed schema
    // doesn't reject them as unknown.
    const {
      use_subscription: _useSub,
      subscription_id: _subId,
      patient_member_name: _memName,
      patient_member_dob: _memDob,
      ...baseFields
    } = rawObj;
    const baseParsed = medevacRequestAuthedSchema.safeParse(baseFields);
    if (!baseParsed.success) {
      return {
        ok: false,
        error: 'validation_failed',
        field_errors: fieldErrorsFromZod(baseParsed.error.issues),
      };
    }

    const rpc = looseClient();
    const { data, error } = await rpc.rpc('consume_aeris_shield_event', {
      p_subscription_id: shieldParsed.data.subscription_id,
      p_client_id: session.client_id,
      p_patient_member_name: shieldParsed.data.patient_member_name,
      p_patient_member_dob: shieldParsed.data.patient_member_dob,
      p_payload: baseParsed.data,
    });
    if (error) {
      console.error('[medevac-clients.shield] rpc error', error);
      return { ok: false, error: 'server_error' };
    }

    const result = data as
      | {
          ok: true;
          medevac_request_id: string;
          medevac_request_number: string;
          booking_id: string;
          covered_events_remaining: number;
        }
      | { ok: false; error: string };

    if (!result.ok) return { ok: false, error: result.error };

    revalidatePath('/me/medevac');
    revalidatePath('/me/bookings');
    revalidatePath('/admin/medevac');

    return {
      ok: true,
      medevac_request_id: result.medevac_request_id,
      medevac_request_number: result.medevac_request_number,
      booking_id: result.booking_id,
      shield_consumed: true,
      covered_events_remaining: result.covered_events_remaining,
    };
  }

  // Out-of-pocket branch — §4.2 create_medevac_request_authenticated.
  // Strip any stray use_subscription field before validation so a
  // falsy value (false/0) doesn't trip the authed schema's strict
  // unknown-key check.
  const { use_subscription: _drop, ...cleanInput } = rawObj;
  const parsed = medevacRequestAuthedSchema.safeParse(cleanInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const ip = clientIp();
  if (!ip) return { ok: false, error: 'ip_required' };

  const rpc = looseClient();
  const { data, error } = await rpc.rpc(
    'create_medevac_request_authenticated',
    {
      p_client_id: session.client_id,
      p_payload: parsed.data,
    }
  );
  if (error) {
    console.error('[medevac-clients.submitAuthed] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        medevac_request_id: string;
        medevac_request_number: string;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/medevac');
  revalidatePath('/admin/medevac');

  return {
    ok: true,
    medevac_request_id: result.medevac_request_id,
    medevac_request_number: result.medevac_request_number,
  };
}

// ============================================================
// 2. acceptMyMedevacOffer → §4.4 client path
// ============================================================

export type AcceptMyMedevacOfferResult =
  | {
      ok: true;
      booking_id: string;
      offer_id: string;
      medevac_request_id: string;
      accepted_at: string;
      // Phase 13 PR 3 — optional redemption envelope (only
      // populated when caller passes cashback_redemption_sar > 0,
      // which UI must suppress for J5 covered-event bookings).
      cashback_redemption?:
        | { ok: true; redeemed_sar: number; new_balance_sar: number }
        | { ok: false; error: string };
    }
  | MedevacClientsActionFailure;

export async function acceptMyMedevacOffer(input: {
  offer_id: string;
  cashback_redemption_sar?: number;
}): Promise<AcceptMyMedevacOfferResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  const parsed = acceptOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const rpc = looseClient();
  const { data, error } = await rpc.rpc('accept_medevac_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: session.client_id,
    p_actor_admin_user_id: null,
  });
  if (error) {
    console.error('[medevac-clients.accept] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        booking_id: string;
        offer_id: string;
        medevac_request_id: string;
        accepted_at: string;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/medevac');
  revalidatePath(`/me/medevac/${result.medevac_request_id}`);
  revalidatePath('/me/bookings');
  revalidatePath('/admin/medevac');

  // Phase 13 PR 3 — optional cashback redemption (see charter
  // accept for the rationale). UI suppresses the input for J5
  // covered-event bookings.
  const redeem = parsed.data.cashback_redemption_sar
    ? await redeemCashbackIfRequested({
        client_id: session.client_id,
        booking_id: result.booking_id,
        cashback_redemption_sar: parsed.data.cashback_redemption_sar,
      })
    : null;

  return {
    ok: true,
    booking_id: result.booking_id,
    offer_id: result.offer_id,
    medevac_request_id: result.medevac_request_id,
    accepted_at: result.accepted_at,
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

// ============================================================
// 3. declineMyMedevacOffer → §4.5 client path
// ============================================================

export type DeclineMyMedevacOfferResult =
  | { ok: true; offer_id: string; already_declined?: boolean }
  | MedevacClientsActionFailure;

export async function declineMyMedevacOffer(input: {
  offer_id: string;
  reason?: string;
}): Promise<DeclineMyMedevacOfferResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  const parsed = declineOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const rpc = looseClient();
  const { data, error } = await rpc.rpc('decline_medevac_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: session.client_id,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[medevac-clients.decline] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; offer_id: string; already_declined?: boolean }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/medevac');

  return {
    ok: true,
    offer_id: result.offer_id,
    already_declined: result.already_declined,
  };
}

// ============================================================
// 4. cancelMyMedevacRequest → §4.6 client path
// ============================================================

export type CancelMyMedevacRequestResult =
  | {
      ok: true;
      request_id: string;
      cascade_declined_offers: number;
      already_cancelled?: boolean;
    }
  | MedevacClientsActionFailure;

export async function cancelMyMedevacRequest(input: {
  request_id: string;
  reason?: string;
}): Promise<CancelMyMedevacRequestResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const rpc = looseClient();
  const { data, error } = await rpc.rpc('cancel_medevac_request', {
    p_request_id: parsed.data.request_id,
    p_actor_client_id: session.client_id,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[medevac-clients.cancel] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        request_id: string;
        cascade_declined_offers: number;
        already_cancelled?: boolean;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/medevac');
  revalidatePath(`/me/medevac/${parsed.data.request_id}`);
  revalidatePath('/admin/medevac');

  return {
    ok: true,
    request_id: result.request_id,
    cascade_declined_offers: result.cascade_declined_offers ?? 0,
    already_cancelled: result.already_cancelled,
  };
}

// ============================================================
// 5. subscribeToAerisShield → §4.8 (returns pending_payment)
//
// Admin flips to 'active' via admin_activate_subscription
// after offline payment confirmation (§4.9).
// ============================================================

export type SubscribeToAerisShieldResult =
  | {
      ok: true;
      subscription_id: string;
      subscription_number: string;
      status: 'pending_payment';
    }
  | MedevacClientsActionFailure;

export async function subscribeToAerisShield(
  input: unknown
): Promise<SubscribeToAerisShieldResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  const parsed = subscribeShieldSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const rpc = looseClient();
  const { data, error } = await rpc.rpc('subscribe_to_aeris_shield', {
    p_client_id: session.client_id,
    p_plan: parsed.data.plan,
    p_owner_dob: parsed.data.owner_dob,
    p_payload_covered_members: parsed.data.covered_members,
  });
  if (error) {
    console.error('[medevac-clients.subscribe] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        subscription_id: string;
        subscription_number: string;
        status: 'pending_payment';
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/medevac/shield');
  revalidatePath('/admin/medevac/subscriptions');

  return {
    ok: true,
    subscription_id: result.subscription_id,
    subscription_number: result.subscription_number,
    status: result.status,
  };
}
