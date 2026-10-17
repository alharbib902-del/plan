'use server';

import { revalidatePath } from 'next/cache';

import { requireAdminSession } from '@/lib/admin/auth';
import { ADMIN_WRITE_ROLES } from '@/lib/admin/rbac';
import {
  confirmOfflinePaymentSchema,
  fieldErrorsFromIssues,
  setFlightStatusSchema,
} from '@/lib/admin/bookings/validators';
import { createAdminClient } from '@/lib/supabase/admin';
import type { BookingFlightStatus } from '@/types/database';

/**
 * Admin bookings Server Actions — manual-settlement mode.
 *
 * Thin wrappers over the SECURITY DEFINER RPCs from migration
 * 20261017000002: auth (owner/admin only — financial + booking-state
 * writes) → Zod → RPC with the session-derived admin id → revalidate.
 * All state rules + the audit_logs row live in the RPC transaction.
 */

export type BookingActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
  expected_amount?: number;
};

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

function revalidateBooking(bookingId: string): void {
  revalidatePath('/admin/bookings');
  revalidatePath(`/admin/bookings/${bookingId}`);
  revalidatePath('/admin/analytics');
}

// ============================================================
// confirmOfflinePayment → admin_confirm_offline_payment
// ============================================================

export type ConfirmOfflinePaymentResult =
  | { ok: true; already_paid: boolean; paid_at: string | null }
  | BookingActionFailure;

export async function confirmOfflinePayment(input: {
  booking_id: string;
  received_amount: string;
  reference: string;
  note?: string;
}): Promise<ConfirmOfflinePaymentResult> {
  const session = await requireAdminSession({ roles: ADMIN_WRITE_ROLES });

  const parsed = confirmOfflinePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }

  const { data, error } = await looseClient().rpc(
    'admin_confirm_offline_payment',
    {
      p_booking_id: parsed.data.booking_id,
      p_admin_user_id: session.adminUserId,
      p_received_amount: parsed.data.received_amount,
      p_reference: parsed.data.reference,
      p_note: parsed.data.note ?? null,
    }
  );
  if (error) {
    console.error('[admin/bookings.confirmOfflinePayment] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; already_paid?: boolean; paid_at?: string | null }
    | { ok: false; error: string; expected_amount?: number | string };

  if (!result.ok) {
    const expected =
      result.expected_amount === undefined
        ? undefined
        : Number(result.expected_amount);
    return {
      ok: false,
      error: result.error,
      ...(expected !== undefined && Number.isFinite(expected)
        ? { expected_amount: expected }
        : {}),
    };
  }

  revalidateBooking(parsed.data.booking_id);
  return {
    ok: true,
    already_paid: result.already_paid === true,
    paid_at: result.paid_at ?? null,
  };
}

// ============================================================
// setBookingFlightStatus → admin_set_flight_status
// ============================================================

export type SetBookingFlightStatusResult =
  | { ok: true; unchanged: boolean; flight_status: BookingFlightStatus }
  | BookingActionFailure;

export async function setBookingFlightStatus(input: {
  booking_id: string;
  status: string;
  note?: string;
}): Promise<SetBookingFlightStatusResult> {
  const session = await requireAdminSession({ roles: ADMIN_WRITE_ROLES });

  const parsed = setFlightStatusSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }

  const { data, error } = await looseClient().rpc('admin_set_flight_status', {
    p_booking_id: parsed.data.booking_id,
    p_admin_user_id: session.adminUserId,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });
  if (error) {
    console.error('[admin/bookings.setBookingFlightStatus] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  const result = data as
    | { ok: true; unchanged?: boolean; flight_status: BookingFlightStatus }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidateBooking(parsed.data.booking_id);
  return {
    ok: true,
    unchanged: result.unchanged === true,
    flight_status: result.flight_status,
  };
}
