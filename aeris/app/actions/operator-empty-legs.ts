'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { validateOperatorEmptyLegSession } from '@/lib/operator/empty-leg-session-store';
import {
  operatorPublishEmptyLegSchema,
  operatorUpdatePriceSchema,
  operatorCancelSchema,
} from '@/lib/validators/empty-legs';
import type {
  CancelEmptyLegResult,
  PublishEmptyLegResult,
  UpdateEmptyLegPriceResult,
} from '@/lib/empty-legs/types';

/**
 * Phase 7 PR 2c — operator-side Server Actions for the
 * Empty Legs self-serve portal.
 *
 * Three actions, all token-bound. Each:
 *   1. Calls `validateOperatorEmptyLegSession(token)` — the
 *      3-layer validator (HMAC + DB hash + DB expiry).
 *   2. Honours the `ENABLE_OPERATOR_PORTAL` flag (default
 *      `false`).
 *   3. Parses input via Zod (defense in depth).
 *   4. **Stub-scoping** (Codex iteration-12 P1 #1 fix):
 *      - Publish — passes the session's stub_id into
 *        `publish_empty_leg` so the new row's
 *        `operator_stub_id` is set to that stub.
 *      - Update / Cancel — pre-SELECT the leg
 *        WHERE id = :leg_id AND operator_stub_id =
 *        :session_stub_id. If zero rows: opaque
 *        `'leg_not_found'` (NOT `'unauthorized'` — the
 *        operator cannot tell whether the leg exists
 *        under another stub).
 *   5. Calls the appropriate RPC.
 *   6. Revalidates the operator portal pages.
 */

export type OperatorActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isPortalFlagDisabled(): boolean {
  return process.env.ENABLE_OPERATOR_PORTAL !== 'true';
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

function revalidateOperatorPaths(token: string, legId?: string): void {
  revalidatePath(`/operator/empty-legs/${token}`);
  if (legId) {
    revalidatePath(`/operator/empty-legs/${token}/${legId}`);
  }
}

// ============================================================
// 1. operatorPublishEmptyLeg
// ============================================================

export type OperatorPublishEmptyLegActionResult =
  | { ok: true; leg_id: string; leg_number: string; current_price: number }
  | OperatorActionFailure;

export async function operatorPublishEmptyLeg(
  token: string,
  input: {
    operator_name?: string | null;
    operator_phone?: string | null;
    operator_email?: string | null;
    aircraft_text?: string | null;
    departure_airport_iata?: string | null;
    departure_airport_freeform?: string | null;
    arrival_airport_iata?: string | null;
    arrival_airport_freeform?: string | null;
    departure_window_start: string;
    departure_window_end: string;
    flexibility_hours?: number | null;
    original_price: number;
    max_passengers: number;
    auction_initial_discount_pct?: number | null;
    auction_floor_discount_pct?: number | null;
    auction_curve?: 'linear' | 'accelerating' | null;
    auction_window_lead_hours?: number | null;
    suppress_notifications?: boolean | null;
  }
): Promise<OperatorPublishEmptyLegActionResult> {
  if (isPortalFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await validateOperatorEmptyLegSession(token);
  if (!session.ok) {
    return { ok: false, error: 'invalid_session' };
  }

  const parsed = operatorPublishEmptyLegSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  const v = parsed.data;

  const client = createAdminClient();
  const { data, error } = await client.rpc('publish_empty_leg', {
    // Stub-scoping enforced here: the session's stub id is
    // forced into the RPC argument. The operator cannot
    // publish a leg under a different stub even if they
    // crafted the input.
    p_operator_id: null,
    p_operator_stub_id: session.operatorStubId,
    p_operator_name: v.operator_name ?? null,
    p_operator_phone: v.operator_phone ?? null,
    p_operator_email: v.operator_email ?? null,
    p_aircraft_id: null,
    p_aircraft_text: v.aircraft_text ?? null,
    p_parent_booking_id: null,
    p_departure_airport_iata: v.departure_airport_iata ?? null,
    p_departure_airport_freeform: v.departure_airport_freeform ?? null,
    p_arrival_airport_iata: v.arrival_airport_iata ?? null,
    p_arrival_airport_freeform: v.arrival_airport_freeform ?? null,
    p_departure_window_start: v.departure_window_start,
    p_departure_window_end: v.departure_window_end,
    p_flexibility_hours: v.flexibility_hours ?? null,
    p_original_price: v.original_price,
    p_max_passengers: v.max_passengers,
    p_auction_initial_discount_pct: v.auction_initial_discount_pct ?? null,
    p_auction_floor_discount_pct: v.auction_floor_discount_pct ?? null,
    p_auction_curve: v.auction_curve ?? null,
    p_auction_window_lead_hours: v.auction_window_lead_hours ?? null,
    p_suppress_notifications: v.suppress_notifications ?? null,
  });

  if (error) {
    console.error('[operator-empty-legs.publish] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as PublishEmptyLegResult;
  revalidateOperatorPaths(token);
  if (result.ok) {
    return {
      ok: true,
      leg_id: result.leg_id,
      leg_number: result.leg_number,
      current_price: result.current_price,
    };
  }
  return { ok: false, error: result.error };
}

// ============================================================
// Internal helper — pre-SELECT the leg under the session's
// stub to enforce stub-scoping before the RPC call. Returns
// `'leg_not_found'` opaquely on miss (the operator cannot
// tell whether the leg exists under another stub).
// ============================================================

async function assertLegBelongsToStub(
  legId: string,
  stubId: string
): Promise<{ ok: true } | { ok: false; error: 'leg_not_found' }> {
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_legs')
    .select('id')
    .eq('id', legId)
    .eq('operator_stub_id', stubId)
    .maybeSingle();

  if (error) {
    console.error('[operator-empty-legs] stub-scope SELECT failed', error);
    return { ok: false, error: 'leg_not_found' };
  }
  if (!data) {
    return { ok: false, error: 'leg_not_found' };
  }
  return { ok: true };
}

// ============================================================
// 2. operatorUpdatePrice
// ============================================================

export type OperatorUpdatePriceActionResult =
  | {
      ok: true;
      leg_id: string;
      current_price: number;
      current_discount_pct: number;
      fired_event: boolean;
    }
  | OperatorActionFailure;

export async function operatorUpdatePrice(
  token: string,
  input: { leg_id: string; new_price: number }
): Promise<OperatorUpdatePriceActionResult> {
  if (isPortalFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await validateOperatorEmptyLegSession(token);
  if (!session.ok) {
    return { ok: false, error: 'invalid_session' };
  }

  const parsed = operatorUpdatePriceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const scope = await assertLegBelongsToStub(
    parsed.data.leg_id,
    session.operatorStubId
  );
  if (!scope.ok) {
    return { ok: false, error: scope.error };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('update_empty_leg_price', {
    p_leg_id: parsed.data.leg_id,
    p_new_price: parsed.data.new_price,
  });

  if (error) {
    console.error('[operator-empty-legs.updatePrice] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as UpdateEmptyLegPriceResult;
  revalidateOperatorPaths(token, parsed.data.leg_id);
  if (result.ok) {
    return {
      ok: true,
      leg_id: result.leg_id,
      current_price: result.current_price,
      current_discount_pct: result.current_discount_pct,
      fired_event: result.fired_event,
    };
  }
  return { ok: false, error: result.error };
}

// ============================================================
// 3. operatorCancel
// ============================================================

export type OperatorCancelActionResult =
  | { ok: true; leg_id: string }
  | OperatorActionFailure;

export async function operatorCancel(
  token: string,
  input: { leg_id: string; reason?: string | null }
): Promise<OperatorCancelActionResult> {
  if (isPortalFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await validateOperatorEmptyLegSession(token);
  if (!session.ok) {
    return { ok: false, error: 'invalid_session' };
  }

  const parsed = operatorCancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const scope = await assertLegBelongsToStub(
    parsed.data.leg_id,
    session.operatorStubId
  );
  if (!scope.ok) {
    return { ok: false, error: scope.error };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('cancel_empty_leg', {
    p_leg_id: parsed.data.leg_id,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) {
    console.error('[operator-empty-legs.cancel] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as CancelEmptyLegResult;
  revalidateOperatorPaths(token, parsed.data.leg_id);
  if (result.ok) {
    return { ok: true, leg_id: result.leg_id };
  }
  return { ok: false, error: result.error };
}
