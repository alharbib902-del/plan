'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOperatorSession } from '@/lib/operators/auth';
import { fireAndForgetMatchTrigger } from '@/lib/empty-legs/match-trigger-fire';
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
 * Phase 8 PR 2c.1 — session-based operator empty-legs Server
 * Actions. Mirrors `app/actions/operator-empty-legs.ts` (Phase 7
 * token-bound) but binds to the cookie-based session via
 * `requireOperatorSession()` and pins legs to `operator_id`
 * instead of `operator_stub_id`.
 *
 * Three actions:
 *   - operatorPublishLegSession  -> publish_empty_leg with
 *                                    p_operator_id=session.id
 *   - operatorUpdatePriceSession -> update_empty_leg_price
 *                                    (operator-scoped)
 *   - operatorCancelLegSession   -> cancel_empty_leg
 *                                    (operator-scoped)
 *
 * Each action:
 *   1. requireOperatorSession() — redirects to /operator/login
 *      on failure (cookie validation via operator_session_validate
 *      RPC). Re-validation on every action call ensures a
 *      mid-session suspend / password-reset propagates.
 *   2. Honours ENABLE_OPERATOR_PORTAL flag.
 *   3. Zod-validates input.
 *   4. Operator-scoping (mirrors Phase 7 stub-scoping):
 *      - Publish: forces p_operator_stub_id=NULL +
 *        p_operator_id=session.operator_id.
 *      - Update / Cancel: pre-SELECT the leg
 *        WHERE id=:leg_id AND operator_id=:session_operator_id.
 *        Zero rows -> opaque 'leg_not_found'.
 *   5. Calls the existing Phase 7 RPC unchanged.
 *   6. Revalidates the new portal paths
 *      (/operator/legs, /operator/legs/[id]).
 */

export type OperatorAuthedActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isPortalFlagDisabled(): boolean {
  return process.env.ENABLE_OPERATOR_PORTAL === 'false';
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

function revalidateOperatorLegPaths(legId?: string): void {
  revalidatePath('/operator/legs');
  revalidatePath('/operator/dashboard');
  if (legId) revalidatePath(`/operator/legs/${legId}`);
}

// ============================================================
// Internal helper: pre-SELECT the leg under the session's
// operator_id to enforce operator-scoping. Returns
// 'leg_not_found' opaquely on miss (operator cannot tell
// whether the leg exists under another operator).
// ============================================================

async function assertLegBelongsToOperator(
  legId: string,
  operatorId: string
): Promise<{ ok: true } | { ok: false; error: 'leg_not_found' }> {
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_legs')
    .select('id')
    .eq('id', legId)
    .eq('operator_id', operatorId)
    .maybeSingle();

  if (error) {
    console.error('[operators-empty-legs-authed] scope SELECT failed', error);
    return { ok: false, error: 'leg_not_found' };
  }
  if (!data) return { ok: false, error: 'leg_not_found' };
  return { ok: true };
}

// ============================================================
// 1. operatorPublishLegSession
// ============================================================

export type OperatorPublishLegSessionResult =
  | { ok: true; leg_id: string; leg_number: string; current_price: number }
  | OperatorAuthedActionFailure;

export async function operatorPublishLegSession(input: {
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
}): Promise<OperatorPublishLegSessionResult> {
  if (isPortalFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireOperatorSession();

  // Block must-change-password operators from publishing — the
  // authed layout already redirects them to /operator/profile/password,
  // but Server Actions can be invoked from any client surface
  // (Codex round 1 PR #42 P1 #1 pattern).
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
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

  // Codex round 1 PR #44 P2 fix: operator identity snapshot
  // (name/phone/email) MUST come from the authenticated
  // operators row, not from the client form. Without this,
  // an authenticated operator could leave fields blank or
  // spoof another company/contact in the leg snapshot — the
  // snapshot is later shown to admin + copied into bookings.
  // The client values arriving in `v.operator_name` etc are
  // discarded here; we keep the form fields disabled in
  // session mode (PR 2c.1 follow-up) so the operator never
  // sees them as editable.
  const { data: opRow, error: opErr } = await client
    .from('operators')
    .select('company_name, contact_phone, contact_email')
    .eq('id', session.operator_id)
    .maybeSingle();
  if (opErr || !opRow) {
    console.error(
      '[operators-empty-legs-authed.publish] operator profile lookup failed',
      opErr
    );
    return { ok: false, error: 'operator_lookup_failed' };
  }

  const { data, error } = await client.rpc('publish_empty_leg', {
    // Operator-scoping: session.operator_id is the source of
    // truth. The operator cannot publish a leg under a
    // different account even if they craft the input.
    p_operator_id: session.operator_id,
    p_operator_stub_id: null,
    // Identity snapshot from the operators row — never
    // client-supplied (Codex round 1 PR #44 P2 fix).
    p_operator_name: opRow.company_name,
    p_operator_phone: opRow.contact_phone,
    p_operator_email: opRow.contact_email,
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
    console.error('[operators-empty-legs-authed.publish] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as PublishEmptyLegResult;
  revalidateOperatorLegPaths();
  if (result.ok) {
    // Synchronous match-trigger fire-and-forget so the
    // operator's published leg surfaces wa.me URLs to founder
    // within seconds without blocking the form (mirrors Phase
    // 7 PR 2e Codex iteration-2/3 fix).
    fireAndForgetMatchTrigger(result.leg_id);
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
// 2. operatorUpdatePriceSession
// ============================================================

export type OperatorUpdatePriceSessionResult =
  | {
      ok: true;
      leg_id: string;
      current_price: number;
      current_discount_pct: number;
      fired_event: boolean;
    }
  | OperatorAuthedActionFailure;

export async function operatorUpdatePriceSession(input: {
  leg_id: string;
  new_price: number;
}): Promise<OperatorUpdatePriceSessionResult> {
  if (isPortalFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = operatorUpdatePriceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const scope = await assertLegBelongsToOperator(
    parsed.data.leg_id,
    session.operator_id
  );
  if (!scope.ok) return { ok: false, error: scope.error };

  const client = createAdminClient();
  const { data, error } = await client.rpc('update_empty_leg_price', {
    p_leg_id: parsed.data.leg_id,
    p_new_price: parsed.data.new_price,
  });

  if (error) {
    console.error('[operators-empty-legs-authed.updatePrice] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as UpdateEmptyLegPriceResult;
  revalidateOperatorLegPaths(parsed.data.leg_id);
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
// 3. operatorCancelLegSession
// ============================================================

export type OperatorCancelLegSessionResult =
  | { ok: true; leg_id: string }
  | OperatorAuthedActionFailure;

export async function operatorCancelLegSession(input: {
  leg_id: string;
  reason?: string | null;
}): Promise<OperatorCancelLegSessionResult> {
  if (isPortalFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = operatorCancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const scope = await assertLegBelongsToOperator(
    parsed.data.leg_id,
    session.operator_id
  );
  if (!scope.ok) return { ok: false, error: scope.error };

  const client = createAdminClient();
  const { data, error } = await client.rpc('cancel_empty_leg', {
    p_leg_id: parsed.data.leg_id,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) {
    console.error('[operators-empty-legs-authed.cancel] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as CancelEmptyLegResult;
  revalidateOperatorLegPaths(parsed.data.leg_id);
  if (result.ok) return { ok: true, leg_id: result.leg_id };
  return { ok: false, error: result.error };
}
