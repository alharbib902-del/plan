'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'crypto';

import { requireAdminSession } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  adminPublishEmptyLegSchema,
  adminUpdatePriceSchema,
  adminCancelSchema,
  adminMarkSoldManualSchema,
  adminConfirmReservationSchema,
  adminReleaseReservationSchema,
  markOutreachSentSchema,
} from '@/lib/validators/empty-legs';
import type {
  AdminMarkEmptyLegSoldResult,
  AdminReleaseEmptyLegReservationResult,
  CancelEmptyLegResult,
  ConfirmEmptyLegReservationResult,
  PublishEmptyLegResult,
  UpdateEmptyLegPriceResult,
} from '@/lib/empty-legs/types';

/**
 * Phase 7 PR 2b — admin Server Actions for the Empty Legs
 * surface. Seven thin wrappers over the SECURITY DEFINER
 * RPCs from PR 2a (§7.2) plus one outreach-row UPDATE.
 *
 * Spec §7.3 names six admin Server Actions explicitly
 * (`adminPublishEmptyLeg`, `adminUpdatePrice`, `adminCancel`,
 * `adminMarkSoldManual`, `adminReleaseReservation`,
 * `markOutreachSent`). Spec §7.3 Case 2 also describes a
 * "تأكيد الحجز" button that calls a "manual confirm Server
 * Action" without naming it; the seventh action below
 * (`adminConfirmReservation`) closes that gap. The
 * count-correction footnote in §7.3 (4 → 5 → 6) did not
 * track Case 2's confirm action; this action is added in
 * PR 2b to complete the Case 2 surface.
 *
 * Every action:
 *   1. Calls `requireAdminSession()` (admin gate).
 *   2. Honours the `ENABLE_EMPTY_LEGS_ADMIN_UI` feature
 *      flag — when explicitly disabled, returns
 *      `flag_disabled` instead of touching the DB.
 *   3. Parses input via Zod (defense in depth — SQL
 *      validates again).
 *   4. Calls the RPC and surfaces its structured error
 *      verbatim.
 *   5. Calls `revalidatePath` so the admin pages re-render
 *      against the mutated row.
 */

export type AdminEmptyLegActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isFlagDisabled(): boolean {
  // The flag is on by default (per spec §7.3); only an
  // explicit "false" disables the surface.
  return process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false';
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

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function revalidateAdminPaths(legId?: string): void {
  revalidatePath('/admin/empty-legs');
  revalidatePath('/admin/empty-legs/outreach-queue');
  if (legId) {
    revalidatePath(`/admin/empty-legs/${legId}`);
  }
}

// ============================================================
// 1. adminPublishEmptyLeg
// ============================================================

export type AdminPublishEmptyLegActionResult =
  | { ok: true; leg_id: string; leg_number: string; current_price: number }
  | AdminEmptyLegActionFailure;

export async function adminPublishEmptyLeg(input: {
  operator_id?: string | null;
  operator_stub_id?: string | null;
  operator_name?: string | null;
  operator_phone?: string | null;
  operator_email?: string | null;
  aircraft_id?: string | null;
  aircraft_text?: string | null;
  parent_booking_id?: string | null;
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
}): Promise<AdminPublishEmptyLegActionResult> {
  requireAdminSession();
  if (isFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminPublishEmptyLegSchema.safeParse(input);
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
    p_operator_id: v.operator_id ?? null,
    p_operator_stub_id: v.operator_stub_id ?? null,
    p_operator_name: v.operator_name ?? null,
    p_operator_phone: v.operator_phone ?? null,
    p_operator_email: v.operator_email ?? null,
    p_aircraft_id: v.aircraft_id ?? null,
    p_aircraft_text: v.aircraft_text ?? null,
    p_parent_booking_id: v.parent_booking_id ?? null,
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
    console.error('[empty-legs.adminPublishEmptyLeg] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as PublishEmptyLegResult;
  revalidateAdminPaths();
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
// 2. adminUpdatePrice
// ============================================================

export type AdminUpdatePriceActionResult =
  | {
      ok: true;
      leg_id: string;
      current_price: number;
      current_discount_pct: number;
      fired_event: boolean;
    }
  | AdminEmptyLegActionFailure;

export async function adminUpdatePrice(input: {
  leg_id: string;
  new_price: number;
}): Promise<AdminUpdatePriceActionResult> {
  requireAdminSession();
  if (isFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminUpdatePriceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('update_empty_leg_price', {
    p_leg_id: parsed.data.leg_id,
    p_new_price: parsed.data.new_price,
  });

  if (error) {
    console.error('[empty-legs.adminUpdatePrice] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as UpdateEmptyLegPriceResult;
  revalidateAdminPaths(parsed.data.leg_id);
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
// 3. adminCancel
// ============================================================

export type AdminCancelActionResult =
  | { ok: true; leg_id: string }
  | AdminEmptyLegActionFailure;

export async function adminCancel(input: {
  leg_id: string;
  reason?: string | null;
}): Promise<AdminCancelActionResult> {
  requireAdminSession();
  if (isFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminCancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('cancel_empty_leg', {
    p_leg_id: parsed.data.leg_id,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) {
    console.error('[empty-legs.adminCancel] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as CancelEmptyLegResult;
  revalidateAdminPaths(parsed.data.leg_id);
  if (result.ok) {
    return { ok: true, leg_id: result.leg_id };
  }
  return { ok: false, error: result.error };
}

// ============================================================
// 4. adminMarkSoldManual
// ============================================================

export type AdminMarkSoldManualActionResult =
  | { ok: true; leg_id: string; booking_id: string }
  | AdminEmptyLegActionFailure;

export async function adminMarkSoldManual(input: {
  leg_id: string;
  customer_name: string;
  customer_phone: string;
}): Promise<AdminMarkSoldManualActionResult> {
  requireAdminSession();
  if (isFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminMarkSoldManualSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_mark_empty_leg_sold', {
    p_leg_id: parsed.data.leg_id,
    p_customer_name: parsed.data.customer_name,
    p_customer_phone: parsed.data.customer_phone,
  });

  if (error) {
    console.error('[empty-legs.adminMarkSoldManual] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as AdminMarkEmptyLegSoldResult;
  revalidateAdminPaths(parsed.data.leg_id);
  if (result.ok) {
    return {
      ok: true,
      leg_id: result.leg_id,
      booking_id: result.booking_id,
    };
  }
  return { ok: false, error: result.error };
}

// ============================================================
// 5. adminConfirmReservation (Case 2 "تأكيد الحجز")
// ============================================================

export type AdminConfirmReservationActionResult =
  | { ok: true; leg_id: string; booking_id: string }
  | AdminEmptyLegActionFailure;

export async function adminConfirmReservation(input: {
  leg_id: string;
  token: string;
}): Promise<AdminConfirmReservationActionResult> {
  requireAdminSession();
  if (isFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminConfirmReservationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const tokenHash = sha256Hex(parsed.data.token);

  const client = createAdminClient();
  const { data, error } = await client.rpc('confirm_empty_leg_reservation', {
    p_leg_id: parsed.data.leg_id,
    p_token_hash: tokenHash,
  });

  if (error) {
    console.error('[empty-legs.adminConfirmReservation] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as ConfirmEmptyLegReservationResult;
  revalidateAdminPaths(parsed.data.leg_id);
  if (result.ok) {
    return {
      ok: true,
      leg_id: result.leg_id,
      booking_id: result.booking_id,
    };
  }
  return { ok: false, error: result.error };
}

// ============================================================
// 6. adminReleaseReservation
// ============================================================

export type AdminReleaseReservationActionResult =
  | { ok: true; leg_id: string }
  | AdminEmptyLegActionFailure;

export async function adminReleaseReservation(input: {
  leg_id: string;
}): Promise<AdminReleaseReservationActionResult> {
  requireAdminSession();
  if (isFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminReleaseReservationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc(
    'admin_release_empty_leg_reservation',
    {
      p_leg_id: parsed.data.leg_id,
    }
  );

  if (error) {
    console.error('[empty-legs.adminReleaseReservation] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as AdminReleaseEmptyLegReservationResult;
  revalidateAdminPaths(parsed.data.leg_id);
  if (result.ok) {
    return { ok: true, leg_id: result.leg_id };
  }
  return { ok: false, error: result.error };
}

// ============================================================
// 7. markOutreachSent
// ============================================================

export type MarkOutreachSentActionResult =
  | { ok: true; notification_id: string }
  | AdminEmptyLegActionFailure;

export async function markOutreachSent(input: {
  notification_id: string;
}): Promise<MarkOutreachSentActionResult> {
  requireAdminSession();
  if (isFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = markOutreachSentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // Idempotent — second click on an already-marked row is
  // a no-op because the .is('outreach_sent_at', null) guard
  // matches zero rows. This is intentional per spec §7.3.
  const client = createAdminClient();
  const { data, error } = await client
    .from('empty_leg_notifications')
    .update({ outreach_sent_at: new Date().toISOString() })
    .eq('id', parsed.data.notification_id)
    .is('outreach_sent_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[empty-legs.markOutreachSent] update error', error);
    return { ok: false, error: 'update_failed' };
  }

  // The .maybeSingle() returns null when the row is either
  // absent or already marked; both are treated as a no-op
  // success per the idempotence contract.
  revalidatePath('/admin/empty-legs/outreach-queue');
  return { ok: true, notification_id: data?.id ?? parsed.data.notification_id };
}
