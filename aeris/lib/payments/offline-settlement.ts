/**
 * Admin offline settlement — pure helpers for the "mark booking paid"
 * action (migration 20260702000001). No DB access here so the tsx unit
 * suite can cover the envelope parsing + the UI gate without a client.
 */

import type { BookingPaymentStatus } from '@/types/database';

export type MarkPaidGate = 'payable' | 'already_paid' | 'refunded';

/** UI/action gate mirroring the RPC's own guards. The RPC re-checks under
 *  a row lock — this only decides what the admin surface offers. */
export function resolveMarkPaidGate(booking: {
  payment_status: BookingPaymentStatus;
  paid_at: string | null;
}): MarkPaidGate {
  if (booking.paid_at !== null || booking.payment_status === 'paid') {
    return 'already_paid';
  }
  if (booking.payment_status === 'refunded') return 'refunded';
  return 'payable';
}

/** Net payable shown to the admin before confirming. The RPC derives its
 *  own amount under the row lock — this is display-only. */
export function offlineNetAmount(booking: {
  total_amount: number;
  cashback_redemption_sar: number | null;
}): number {
  return booking.total_amount - (booking.cashback_redemption_sar ?? 0);
}

/** gateway_response payload for the offline ledger row: who confirmed it
 *  and when. Keeps the same audit-forensics shape idea as the gateway raw. */
export function buildOfflineSettlementRaw(args: {
  reference: string | null;
  markedAtIso: string;
  adminSessionFingerprint: string | null;
}): Record<string, unknown> {
  return {
    source: 'admin_offline_settlement',
    reference: args.reference,
    marked_at: args.markedAtIso,
    admin_session_fingerprint: args.adminSessionFingerprint,
  };
}

export type AdminMarkPaidResult =
  | { ok: true; already: boolean; bookingNumber: string; amount: number | null }
  | {
      ok: false;
      error:
        | 'booking_not_found'
        | 'already_paid'
        | 'booking_refunded'
        | 'rpc_failed';
    };

const KNOWN_ERRORS = new Set([
  'booking_not_found',
  'already_paid',
  'booking_refunded',
]);

/** Parse the RPC's JSONB envelope. Any transport error or malformed shape
 *  collapses to rpc_failed (fail-closed: the admin retries, nothing is
 *  assumed to have happened). */
export function parseAdminMarkPaidResult(
  data: unknown,
  error: { message?: string } | null
): AdminMarkPaidResult {
  if (error) return { ok: false, error: 'rpc_failed' };
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'rpc_failed' };
  }
  const row = data as Record<string, unknown>;
  if (row.ok === true) {
    if (typeof row.booking_number !== 'string') {
      return { ok: false, error: 'rpc_failed' };
    }
    return {
      ok: true,
      already: row.already === true,
      bookingNumber: row.booking_number,
      amount: typeof row.amount === 'number' ? row.amount : null,
    };
  }
  if (row.ok === false && typeof row.error === 'string') {
    if (KNOWN_ERRORS.has(row.error)) {
      return {
        ok: false,
        error: row.error as
          | 'booking_not_found'
          | 'already_paid'
          | 'booking_refunded',
      };
    }
    return { ok: false, error: 'rpc_failed' };
  }
  return { ok: false, error: 'rpc_failed' };
}
