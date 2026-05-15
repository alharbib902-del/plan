'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { cargoRequestAuthedSchema } from '@/lib/cargo/validators/cargo-request';
import {
  acceptOfferSchema,
  declineOfferSchema,
  cancelRequestSchema,
} from '@/lib/cargo/validators/cargo-actions';

/**
 * Phase 11 PR 2 — authenticated client cargo Server Actions.
 *
 * 4 actions (per spec §3.1):
 *   - submitCargoRequestAuthed → wraps §4.2 create_cargo_request_authenticated
 *   - acceptMyCargoOffer → wraps §4.4 accept_cargo_offer (client path)
 *   - declineMyCargoOffer → wraps §4.5 decline_cargo_offer (client path)
 *   - cancelMyCargoRequest → wraps §4.6 cancel_cargo_request (client path)
 *
 * Each action mirrors Phase 9/10 client action discipline:
 *   - Honour ENABLE_CARGO flag (fail-closed, defense-in-depth)
 *   - Require session via requireClientSession (cookie-based)
 *   - Zod-validate input shape
 *   - Call SECURITY DEFINER RPC via service-role client
 *   - Map RPC error codes to opaque user-facing keys
 *   - Revalidate affected paths on success
 *
 * Auth model (per spec §3.1):
 *   - Client path: requireClientSession() resolves to client_id;
 *     RPC called with p_actor_client_id=client_id,
 *     p_actor_admin_user_id=null. The §4.4-§4.6 RPCs reject
 *     `actor_ambiguous` if both actor IDs are non-NULL — this
 *     can never happen on the client path because we always pass
 *     admin_user_id=null.
 *
 * NOTE: requireClientSession() throws NEXT_REDIRECT to /login on
 * missing/invalid session. The `unauthorized` defensive return
 * after `await` is unreachable in practice but matches Phase 10
 * convention for type-completeness.
 */

export type CargoClientsActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isCargoDisabled(): boolean {
  return process.env.ENABLE_CARGO !== 'true';
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
// 1. submitCargoRequestAuthed → §4.2 create_cargo_request_authenticated
// ============================================================

export type SubmitCargoRequestAuthedResult =
  | {
      ok: true;
      cargo_request_id: string;
      cargo_request_number: string;
      created_at: string;
    }
  | CargoClientsActionFailure;

export async function submitCargoRequestAuthed(
  input: unknown
): Promise<SubmitCargoRequestAuthedResult> {
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  // Authed schema (no customer_* fields — those come from the
  // clients table inside the §4.2 RPC).
  const parsed = cargoRequestAuthedSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const ip = clientIp();
  if (!ip) return { ok: false, error: 'ip_required' };

  const client = looseClient();
  const { data, error } = await client.rpc(
    'create_cargo_request_authenticated',
    {
      p_payload: parsed.data,
      p_client_id: session.client_id,
      p_ip: ip,
    }
  );
  if (error) {
    console.error('[cargo-clients.submitAuthed] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        cargo_request_id: string;
        cargo_request_number: string;
        created_at: string;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/cargo-requests');
  revalidatePath('/admin/cargo');

  return {
    ok: true,
    cargo_request_id: result.cargo_request_id,
    cargo_request_number: result.cargo_request_number,
    created_at: result.created_at,
  };
}

// ============================================================
// 2. acceptMyCargoOffer → §4.4 accept_cargo_offer (client path)
// ============================================================

export type AcceptMyCargoOfferResult =
  | {
      ok: true;
      booking_id: string;
      offer_id: string;
      cargo_request_id: string;
      accepted_at: string;
    }
  | CargoClientsActionFailure;

export async function acceptMyCargoOffer(input: {
  offer_id: string;
}): Promise<AcceptMyCargoOfferResult> {
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

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

  const client = looseClient();
  const { data, error } = await client.rpc('accept_cargo_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: session.client_id,
    p_actor_admin_user_id: null,
  });
  if (error) {
    console.error('[cargo-clients.accept] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        booking_id: string;
        offer_id: string;
        cargo_request_id: string;
        accepted_at: string;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/cargo-requests');
  revalidatePath(`/me/cargo-requests/${result.cargo_request_id}`);
  revalidatePath('/me/bookings');
  revalidatePath('/admin/cargo');

  return {
    ok: true,
    booking_id: result.booking_id,
    offer_id: result.offer_id,
    cargo_request_id: result.cargo_request_id,
    accepted_at: result.accepted_at,
  };
}

// ============================================================
// 3. declineMyCargoOffer → §4.5 decline_cargo_offer (client path)
// ============================================================

export type DeclineMyCargoOfferResult =
  | { ok: true; offer_id: string; already_declined?: boolean }
  | CargoClientsActionFailure;

export async function declineMyCargoOffer(input: {
  offer_id: string;
  reason?: string;
}): Promise<DeclineMyCargoOfferResult> {
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

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

  const client = looseClient();
  const { data, error } = await client.rpc('decline_cargo_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: session.client_id,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[cargo-clients.decline] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; offer_id: string; already_declined?: boolean }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/me/cargo-requests');

  return {
    ok: true,
    offer_id: result.offer_id,
    already_declined: result.already_declined,
  };
}

// ============================================================
// 4. cancelMyCargoRequest → §4.6 cancel_cargo_request (client path)
// ============================================================

export type CancelMyCargoRequestResult =
  | {
      ok: true;
      request_id: string;
      cascade_declined_offers: number;
      already_cancelled?: boolean;
    }
  | CargoClientsActionFailure;

export async function cancelMyCargoRequest(input: {
  request_id: string;
  reason?: string;
}): Promise<CancelMyCargoRequestResult> {
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

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

  const client = looseClient();
  const { data, error } = await client.rpc('cancel_cargo_request', {
    p_request_id: parsed.data.request_id,
    p_actor_client_id: session.client_id,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[cargo-clients.cancel] rpc error', error);
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

  revalidatePath('/me/cargo-requests');
  revalidatePath(`/me/cargo-requests/${parsed.data.request_id}`);

  return {
    ok: true,
    request_id: result.request_id,
    cascade_declined_offers: result.cascade_declined_offers ?? 0,
    already_cancelled: result.already_cancelled,
  };
}
