'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPublicLegByNumber } from '@/lib/empty-legs/public-queries';
import {
  hashReservationToken,
  mintReservationToken,
} from '@/lib/empty-legs/reservation-token';
import { verifyOptOutToken } from '@/lib/empty-legs/opt-out-token';
import {
  publicCancelMyReservationSchema,
  publicConfirmOptOutSchema,
  publicReserveEmptyLegSchema,
} from '@/lib/validators/empty-legs';
import type {
  ReleaseEmptyLegReservationResult,
  ReserveEmptyLegResult,
} from '@/lib/empty-legs/types';

/**
 * Phase 7 PR 2d — anon-callable Server Actions for the
 * public Empty Legs marketplace.
 *
 * Three actions:
 *   1. reserveEmptyLeg(leg_number, name, phone, opt_in)
 *      - Mints a 10-minute reservation token, hashes it,
 *        calls `reserve_empty_leg` RPC, persists a
 *        `lead_inquiries` row + sets `empty_legs_opt_in =
 *        TRUE` only when `opt_in === true`.
 *   2. cancelMyReservation(leg_number, reservation_token)
 *      - SHA256-hashes the raw token, calls
 *        `release_empty_leg_reservation` per Codex
 *        iteration-1 P1 #3.
 *   3. confirmOptOut(opt_out_token) — verifies the HMAC
 *      token, updates `lead_inquiries.empty_legs_opt_in =
 *      FALSE` for the embedded lead_inquiry_id.
 *
 * Every action honours `ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE`
 * (default `false`); the customer-facing pages also check
 * the flag and `notFound()` when disabled, so this is
 * defense in depth at the action layer.
 */

export type PublicActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isPublicFlagDisabled(): boolean {
  return process.env.ENABLE_EMPTY_LEGS_PUBLIC_MARKETPLACE !== 'true';
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

// ============================================================
// 1. reserveEmptyLeg
// ============================================================

export type ReserveEmptyLegActionResult =
  | {
      ok: true;
      leg_id: string;
      leg_number: string;
      reservation_token: string;
      reservation_expires_at: string;
    }
  | PublicActionFailure;

export async function reserveEmptyLeg(input: {
  leg_number: string;
  customer_name: string;
  customer_phone: string;
  opt_in: boolean;
}): Promise<ReserveEmptyLegActionResult> {
  if (isPublicFlagDisabled()) {
    return { ok: false, error: 'flag_disabled_public' };
  }

  const parsed = publicReserveEmptyLegSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  const v = parsed.data;

  const leg = await getPublicLegByNumber(v.leg_number, {
    allowedStatuses: ['available'],
  });
  if (!leg) {
    return { ok: false, error: 'leg_not_found' };
  }

  // Mint a 10-minute reservation token. The DB stores only
  // the SHA256 hash; the raw token is returned to the
  // customer once and never persisted server-side beyond
  // this response.
  let minted;
  try {
    minted = mintReservationToken({ legId: leg.id });
  } catch (err) {
    console.error('[empty-legs.reserveEmptyLeg] mint failed', err);
    return { ok: false, error: 'reservation_mint_failed' };
  }

  const tokenHash = hashReservationToken(minted.token);
  const expiresAt = new Date(minted.payload.expires_at * 1000);

  const client = createAdminClient();
  const { data, error } = await client.rpc('reserve_empty_leg', {
    p_leg_id: leg.id,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt.toISOString(),
    p_customer_name: v.customer_name,
    p_customer_phone: v.customer_phone,
  });

  if (error) {
    console.error('[empty-legs.reserveEmptyLeg] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as ReserveEmptyLegResult;
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Persist a lead_inquiries row for the matching engine
  // (PR 2e) to use later. `empty_legs_opt_in` is the
  // explicit consent flag — Codex iteration-1 P1 #1 fix:
  // ONLY when the customer ticks opt_in.
  //
  // The `lead_inquiries` table requires trip_type / origin /
  // destination / departure_date / passengers / notes. We
  // populate them from the leg snapshot so the matching
  // engine has a usable record for future similar-route
  // matches. Best-effort: a failed insert here does NOT
  // roll back the reservation (the customer should still
  // receive the booked link). The error is logged for the
  // founder to investigate.
  const originLabel =
    leg.departure_airport ??
    leg.departure_airport_freeform_snapshot ??
    'unknown';
  const destinationLabel =
    leg.arrival_airport ??
    leg.arrival_airport_freeform_snapshot ??
    'unknown';
  const departureDate = leg.departure_window_start
    ? leg.departure_window_start.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const { error: leadErr } = await client.from('lead_inquiries').insert({
    customer_name: v.customer_name,
    customer_phone: v.customer_phone,
    trip_type: 'one_way',
    origin: originLabel,
    destination: destinationLabel,
    origin_iata: leg.departure_airport,
    destination_iata: leg.arrival_airport,
    departure_date: departureDate,
    return_date: null,
    passengers: 1,
    notes: `Empty Leg reservation: ${leg.leg_number}`,
    source: 'empty_legs_reserve',
    empty_legs_opt_in: v.opt_in,
  });
  if (leadErr) {
    console.error(
      '[empty-legs.reserveEmptyLeg] lead_inquiries insert failed',
      leadErr
    );
  }

  // Revalidate the public list + leg detail so the row's
  // status flip from 'available' to 'reserved' renders
  // correctly on subsequent visits.
  revalidatePath('/empty-legs');
  revalidatePath(`/empty-legs/${v.leg_number}`);

  return {
    ok: true,
    leg_id: result.leg_id,
    leg_number: v.leg_number,
    reservation_token: minted.token,
    reservation_expires_at: result.reservation_expires_at,
  };
}

// ============================================================
// 2. cancelMyReservation
// ============================================================

export type CancelMyReservationActionResult =
  | { ok: true; leg_id: string; leg_number: string }
  | PublicActionFailure;

export async function cancelMyReservation(input: {
  leg_number: string;
  reservation_token: string;
}): Promise<CancelMyReservationActionResult> {
  if (isPublicFlagDisabled()) {
    return { ok: false, error: 'flag_disabled_public' };
  }

  const parsed = publicCancelMyReservationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  const v = parsed.data;

  const leg = await getPublicLegByNumber(v.leg_number, {
    allowedStatuses: ['available', 'reserved'],
  });
  if (!leg) {
    return { ok: false, error: 'leg_not_found' };
  }

  const tokenHash = hashReservationToken(v.reservation_token);
  const client = createAdminClient();
  const { data, error } = await client.rpc(
    'release_empty_leg_reservation',
    {
      p_leg_id: leg.id,
      p_token_hash: tokenHash,
    }
  );

  if (error) {
    console.error('[empty-legs.cancelMyReservation] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as ReleaseEmptyLegReservationResult;
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath('/empty-legs');
  revalidatePath(`/empty-legs/${v.leg_number}`);

  return { ok: true, leg_id: result.leg_id, leg_number: v.leg_number };
}

// ============================================================
// 3. confirmOptOut
// ============================================================

export type ConfirmOptOutActionResult =
  | { ok: true; lead_inquiry_id: string }
  | PublicActionFailure;

export async function confirmOptOut(input: {
  opt_out_token: string;
}): Promise<ConfirmOptOutActionResult> {
  if (isPublicFlagDisabled()) {
    return { ok: false, error: 'flag_disabled_public' };
  }

  const parsed = publicConfirmOptOutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const verified = verifyOptOutToken(parsed.data.opt_out_token);
  if (!verified.valid) {
    return { ok: false, error: 'opt_out_invalid' };
  }

  const client = createAdminClient();
  const { data, error } = await client
    .from('lead_inquiries')
    .update({ empty_legs_opt_in: false })
    .eq('id', verified.payload.lead_inquiry_id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[empty-legs.confirmOptOut] update error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  if (!data) {
    return { ok: false, error: 'lead_inquiry_not_found' };
  }

  return { ok: true, lead_inquiry_id: data.id };
}
