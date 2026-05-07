'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminSession } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { adminAttachAddonSchema } from '@/lib/validators/booking-addons';
import type {
  AdminCancelBookingAddonResult,
  AttachBookingAddonResult,
  BackfillBookingFromOfferResult,
  BookingAddonRow,
  UpdateBookingAddonQuantityResult,
} from '@/types/database';

/**
 * Phase 6.2 PR 2b: admin Server Actions for booking add-ons.
 *
 * All 4 mutation Server Actions are **thin wrappers** around
 * PR 2a's SECURITY DEFINER RPCs. Each:
 *
 *   1. Calls `requireAdminSession()` (admin guard).
 *   2. Parses input via Zod.
 *   3. Calls the appropriate RPC via `supabase.rpc(...)`.
 *   4. Revalidates the admin trip page (so the new
 *      booking_addons + recomputed totals re-render).
 *
 * Atomicity lives at the DB layer. The Server Action does
 * NOT issue separate INSERT + UPDATE statements that could
 * partially succeed. This is the iteration-5 P1 contract:
 * every booking-state mutation goes through one
 * SECURITY DEFINER transaction.
 */

// ============================================================================
// Shared error shape
// ============================================================================

export type AdminAddonActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

// ============================================================================
// attachAddon — admin attach (calls attach_booking_addon RPC)
// ============================================================================

export type AttachAddonActionResult =
  | { ok: true; addon: BookingAddonRow }
  | AdminAddonActionFailure;

export async function attachAddon(input: {
  trip_request_id: string;
  addon_subtype: string;
  unit_price_override?: number | null;
  quantity?: number | null;
  note?: string | null;
}): Promise<AttachAddonActionResult> {
  await requireAdminSession();

  // Zod parse first — defense in depth alongside the SQL
  // function's own range / subtype checks.
  const parsed = adminAttachAddonSchema.safeParse({
    trip_request_id: input.trip_request_id,
    addon_subtype: input.addon_subtype,
    unit_price_override: input.unit_price_override ?? undefined,
    quantity: input.quantity ?? undefined,
    note: input.note ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'validation_failed', field_errors: fieldErrors };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('attach_booking_addon', {
    p_trip_id: parsed.data.trip_request_id,
    p_addon_subtype: parsed.data.addon_subtype,
    p_quantity: parsed.data.quantity ?? null,
    p_unit_price_override: parsed.data.unit_price_override ?? null,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    console.error('[admin/booking-addons.attachAddon] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as AttachBookingAddonResult;
  revalidatePath(`/admin/trips/${input.trip_request_id}`);
  revalidatePath(`/admin/trips/${input.trip_request_id}/addons`);
  if (result.ok) {
    return { ok: true, addon: result.addon };
  }
  return { ok: false, error: result.error };
}

// ============================================================================
// detachAddon — admin cancel (calls admin_cancel_booking_addon RPC)
// ============================================================================
//
// Codex iteration-6 P1 fix: distinct from the customer
// remove path. Allows BOTH 'pending' AND 'confirmed' →
// 'cancelled' (founder may cancel a customer-confirmed addon
// after a follow-up WhatsApp call). Rejects 'cancelled' /
// 'delivered' with the appropriate terminal-state error.

const detachAddonSchema = z.object({
  booking_addon_id: z.string().uuid('booking_addon_id_invalid'),
  /**
   * The trip id the admin is currently viewing — used only
   * for revalidatePath; the SQL function looks up the
   * booking via the addon's booking_id.
   */
  trip_request_id: z.string().uuid('trip_request_id_invalid'),
});

export type DetachAddonActionResult =
  | { ok: true; addon: BookingAddonRow }
  | AdminAddonActionFailure;

export async function detachAddon(input: {
  booking_addon_id: string;
  trip_request_id: string;
}): Promise<DetachAddonActionResult> {
  await requireAdminSession();

  const parsed = detachAddonSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'validation_failed', field_errors: fieldErrors };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('admin_cancel_booking_addon', {
    p_booking_addon_id: parsed.data.booking_addon_id,
  });

  if (error) {
    console.error('[admin/booking-addons.detachAddon] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as AdminCancelBookingAddonResult;
  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}`);
  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}/addons`);
  if (result.ok) {
    return { ok: true, addon: result.addon };
  }
  return { ok: false, error: result.error };
}

// ============================================================================
// updateAddonQuantity — admin quantity adjust (calls update_booking_addon_quantity)
// ============================================================================
//
// Per_passenger subtypes are quantity-locked to the booking's
// passengers_count_snapshot — the SQL function returns
// `quantity_locked_by_passenger_count`. The Server Action
// surfaces this verbatim so the admin UI can show a clear
// "غير قابل للتعديل" message.

const updateAddonQuantitySchema = z.object({
  booking_addon_id: z.string().uuid('booking_addon_id_invalid'),
  quantity: z
    .number()
    .int('quantity_invalid')
    .min(1, 'quantity_min')
    .max(50, 'quantity_max'),
  trip_request_id: z.string().uuid('trip_request_id_invalid'),
});

export type UpdateAddonQuantityActionResult =
  | { ok: true; addon: BookingAddonRow }
  | AdminAddonActionFailure;

export async function updateAddonQuantity(input: {
  booking_addon_id: string;
  quantity: number;
  trip_request_id: string;
}): Promise<UpdateAddonQuantityActionResult> {
  await requireAdminSession();

  const parsed = updateAddonQuantitySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'validation_failed', field_errors: fieldErrors };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('update_booking_addon_quantity', {
    p_booking_addon_id: parsed.data.booking_addon_id,
    p_quantity: parsed.data.quantity,
  });

  if (error) {
    console.error('[admin/booking-addons.updateAddonQuantity] RPC error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as UpdateBookingAddonQuantityResult;
  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}`);
  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}/addons`);
  if (result.ok) {
    return { ok: true, addon: result.addon };
  }
  return { ok: false, error: result.error };
}

// ============================================================================
// backfillBookingFromAcceptedOffer — Case C escape valve
// ============================================================================
//
// Calls `backfill_booking_from_offer(p_trip_id)` per spec
// S4.1. The SQL function counts accepted offers across both
// Phase 4 + Phase 5 tables (Codex iteration-3 P2 #1: returns
// `ambiguous_accepted_offer` when > 1, `no_accepted_offer`
// when 0). On the unique-accepted happy path, INSERTs the
// bookings row using the same shape as accept_offer's body.
//
// Founder uses this from the admin add-ons page's Case C
// state, once per legacy booked trip identified in
// Probe 5b. The button is idempotent — a second click on
// the same trip returns `booking_already_exists`.

const backfillBookingSchema = z.object({
  trip_request_id: z.string().uuid('trip_request_id_invalid'),
});

export type BackfillBookingActionResult =
  | { ok: true; booking_id: string; source: 'phase4' | 'phase5' }
  | AdminAddonActionFailure;

export async function backfillBookingFromAcceptedOffer(input: {
  trip_request_id: string;
}): Promise<BackfillBookingActionResult> {
  await requireAdminSession();

  const parsed = backfillBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_failed' };
  }

  const client = createAdminClient();
  const { data, error } = await client.rpc('backfill_booking_from_offer', {
    p_trip_id: parsed.data.trip_request_id,
  });

  if (error) {
    console.error(
      '[admin/booking-addons.backfillBookingFromAcceptedOffer] RPC error',
      error
    );
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as BackfillBookingFromOfferResult;
  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}`);
  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}/addons`);
  if (result.ok) {
    return { ok: true, booking_id: result.booking_id, source: result.source };
  }
  return {
    ok: false,
    error:
      result.error === 'ambiguous_accepted_offer'
        ? `ambiguous_accepted_offer:${result.accepted_count}`
        : result.error,
  };
}
