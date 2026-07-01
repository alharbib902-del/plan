'use server';

import { createHmac } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';

import {
  ADMIN_COOKIE_NAME,
  requireAdminSession,
} from '@/lib/admin/auth';
import { ADMIN_WRITE_ROLES } from '@/lib/admin/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildOfflineSettlementRaw,
  parseAdminMarkPaidResult,
  type AdminMarkPaidResult,
} from '@/lib/payments/offline-settlement';

/**
 * Admin "mark booking paid (offline settlement)" action.
 *
 * The platform collects money offline today (bank transfer after the
 * WhatsApp coordination call). This action lets the founder record that the
 * money arrived: it calls admin_mark_booking_paid_offline (migration
 * 20260702000001) which writes a provider='offline' success ledger row and
 * flips the booking to 'paid' through the SAME paid-state triggers the
 * gateway path uses (paid_at stamp + cashback award + tier eval; referral
 * rewards follow via their cron).
 *
 * Idempotent: a double-click lands on the RPC's already-paid guard and
 * returns ok:true/already:true. Guest bookings (client_id NULL) and
 * fully-redeemed bookings (net = 0) are both markable — the two cases the
 * client gateway path rejects by design.
 *
 * Audit: D17 invariant (audit_logs.user_id = NULL; session identity via
 * cookie_expiry + HMAC cookie_fingerprint using
 * ADMIN_AUDIT_FINGERPRINT_SECRET). Fail-closed: missing secret →
 * `secret_not_set`, and the audit row is written BEFORE the RPC so a
 * settlement can never happen unaudited.
 */

const markPaidSchema = z.object({
  booking_id: z.string().uuid('booking_id_invalid'),
  trip_id: z.string().uuid('trip_id_invalid'),
  reference: z.string().trim().max(200, 'reference_too_long').optional(),
});

export type MarkBookingPaidActionResult =
  | AdminMarkPaidResult
  | { ok: false; error: 'validation_failed' | 'secret_not_set' };

type LooseAdminClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<{
      error: { message?: string } | null;
    }>;
  };
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export async function markBookingPaidOffline(input: {
  booking_id: string;
  trip_id: string;
  reference?: string;
}): Promise<MarkBookingPaidActionResult> {
  const session = await requireAdminSession({ roles: ADMIN_WRITE_ROLES });

  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_failed' };
  }
  const reference =
    parsed.data.reference && parsed.data.reference.length > 0
      ? parsed.data.reference
      : null;

  const secret = process.env.ADMIN_AUDIT_FINGERPRINT_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) {
    console.error('[admin/mark-paid] ADMIN_AUDIT_FINGERPRINT_SECRET not set');
    return { ok: false, error: 'secret_not_set' };
  }
  const rawCookie = (await cookies()).get(ADMIN_COOKIE_NAME)?.value ?? '';
  const fingerprint = createHmac('sha256', secret)
    .update(rawCookie, 'utf8')
    .digest('hex');
  const cookieExpiry =
    typeof session.expiry === 'number' ? String(session.expiry) : '';

  const admin = createAdminClient() as unknown as LooseAdminClient;

  const { error: auditError } = await admin.from('audit_logs').insert({
    entity_type: 'booking_payment',
    entity_id: parsed.data.booking_id,
    action: 'admin_mark_booking_paid_offline',
    user_id: null,
    new_value: {
      booking_id: parsed.data.booking_id,
      reference,
      cookie_fingerprint: fingerprint,
      cookie_expiry: cookieExpiry,
    },
  });
  if (auditError) {
    console.error('[admin/mark-paid] audit insert failed', auditError);
    return { ok: false, error: 'rpc_failed' };
  }

  const { data, error } = await admin.rpc('admin_mark_booking_paid_offline', {
    p_booking_id: parsed.data.booking_id,
    p_reference: reference,
    p_raw: buildOfflineSettlementRaw({
      reference,
      markedAtIso: new Date().toISOString(),
      adminSessionFingerprint: fingerprint,
    }),
  });
  if (error) {
    console.error('[admin/mark-paid] rpc error', error);
  }

  const result = parseAdminMarkPaidResult(data, error);

  if (result.ok) {
    revalidatePath(`/admin/trips/${parsed.data.trip_id}`);
    revalidatePath(`/admin/trips/${parsed.data.trip_id}/addons`);
  }

  return result;
}
