'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { fireAndForgetTripDispatch } from '@/lib/automation/trip-dispatch-fire';
import {
  createTripRequestSchema,
  cancelTripRequestSchema,
} from '@/lib/validators/clients';

/**
 * Phase 9 PR 2 — authenticated trip-request Server Actions.
 *
 * 2 actions in this module (PR 3 will extend with offer
 * accept / decline):
 *   - createAuthenticatedTripRequest — wraps the §4.2 RPC.
 *     Optionally fires the auto-dispatch trigger, gated by
 *     ENABLE_TRIP_AUTO_DISTRIBUTION === 'true' (default off
 *     until PR 4 + probes 16 + 17 pass).
 *   - cancelMyTripRequest — single conditional UPDATE that
 *     enforces ownership AND status guard inside the SQL
 *     WHERE clause (Codex round 4 P1 #1 + round 5 P2 #2 fix
 *     on spec). Zero rows → opaque cancel_not_allowed.
 *
 * Mirrors PR 1 client-action discipline (Phase 9 conventions
 * #1 looseClient + #6 opaque errors + #9 structured contract
 * codes).
 */

export type ClientTripActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

// Codex round 1 PR #55 P2 #2 carry-over: fail-closed flag.
function isPortalDisabled(): boolean {
  return process.env.ENABLE_CLIENT_PORTAL !== 'true';
}

function isAutoDistributionEnabled(): boolean {
  return process.env.ENABLE_TRIP_AUTO_DISTRIBUTION === 'true';
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

// Phase 9 PR 1 carry-over (convention #1): no Functions map
// entry for the new RPC. Every .rpc() call goes through this
// loose-typed accessor that preserves the Supabase JS
// internal `this` binding (Phase 8 PR 2e #51 fix).
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
// 1. createAuthenticatedTripRequest
// ============================================================

export type CreateAuthenticatedTripRequestResult =
  | { ok: true; trip_request_id: string; request_number: string }
  | ClientTripActionFailure;

export async function createAuthenticatedTripRequest(input: {
  legs: Array<{
    from: string;
    to: string;
    date: string;
    time?: string | null;
  }>;
  departure_iata: string;
  arrival_iata: string;
  departure_date: string;
  return_date?: string | null;
  passengers: number;
  aircraft_pref?:
    | 'light'
    | 'mid'
    | 'super_mid'
    | 'heavy'
    | 'long_range'
    | null;
  special_requests?: string | null;
}): Promise<CreateAuthenticatedTripRequestResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

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
      p_client_id: session.client_id,
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
      '[clients-trip-requests.createAuthenticatedTripRequest] rpc error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; trip_request_id: string; request_number: string }
    | { ok: false; error: string };

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Auto-dispatch trigger — gated. PR 4 ships the matching
  // endpoint; until then the flag stays off and this branch
  // is dead code in production. Phase 9 spec §5 PR 2 + spec
  // round 1 P1 #3 alignment: default-off, founder flips after
  // probes 16 + 17.
  if (isAutoDistributionEnabled()) {
    fireAndForgetTripDispatch(result.trip_request_id);
  }

  // Refresh the requests list (PR 3 surface) so a follow-up
  // /me/requests render shows the new row immediately.
  revalidatePath('/me/requests');
  revalidatePath('/me/charter');

  return {
    ok: true,
    trip_request_id: result.trip_request_id,
    request_number: result.request_number,
  };
}

// ============================================================
// 2. cancelMyTripRequest
// ============================================================
//
// Single conditional UPDATE that asserts BOTH ownership AND
// status guard inside the SQL WHERE clause (Phase 9 spec §5
// PR 2 — Codex round 4 P1 #1 + round 5 P2 #2 simplification).
// A status='booked' trip MUST NOT be cancellable from this
// Server Action; the booking-cancellation flow lives
// separately in admin (Phase 10 client-side scope).
//
// Single result shape (Codex round 5 P2 #2 fix): zero rows
// returned → opaque `cancel_not_allowed`. The earlier
// `already_cancelled` branch was unreachable because a
// cancelled row also fails the WHERE predicate, returning
// zero rows indistinguishably from booked / cross-owner /
// not-found. Matches Phase 8 `leg_not_found` discipline.

export type CancelMyTripRequestResult =
  | { ok: true; trip_request_id: string }
  | ClientTripActionFailure;

export async function cancelMyTripRequest(input: {
  trip_request_id: string;
}): Promise<CancelMyTripRequestResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();

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
    .eq('client_id', session.client_id)
    .in('status', ['pending', 'distributed', 'offered'])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(
      '[clients-trip-requests.cancelMyTripRequest] update error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  if (!data) {
    // Opaque single-error model (Phase 9 spec §5 PR 2). Could
    // be: trip not owned by this client, or trip in
    // booked/cancelled status, or trip id not found. Never
    // leak which guard tripped.
    return { ok: false, error: 'cancel_not_allowed' };
  }

  revalidatePath('/me/requests');
  revalidatePath(`/me/requests/${parsed.data.trip_request_id}`);

  return { ok: true, trip_request_id: parsed.data.trip_request_id };
}
