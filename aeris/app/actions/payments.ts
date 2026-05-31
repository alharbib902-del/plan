'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { getPaymentProvider } from '@/lib/payments/provider';
import {
  createPaymentAttempt,
  confirmBookingPayment,
  failPaymentAttempt,
  findPaymentByCheckoutId,
} from '@/lib/payments/payments';

/**
 * Phase: payments PR1 — client checkout Server Actions.
 *
 * startCheckout: (optional cashback redeem, pre-payment) → derive net amount →
 * gateway createCheckout → record the attempt (persists checkout_id).
 * confirmCheckout: status-lookup-first — the gateway's server-side status is
 * the source of truth; on success we call confirm_booking_payment which flips
 * the booking to paid (existing triggers cascade cashback/tier/referral).
 *
 * Gated by ENABLE_PAYMENTS (fail-closed) — stays off until live credentials +
 * the webhook verifier are wired.
 */

function isPaymentsDisabled(): boolean {
  return process.env.ENABLE_PAYMENTS !== 'true';
}

// Loose admin client: `bookings.paid_at` / `cashback_redemption_sar` are not in
// the hand-maintained types/database.ts (loose-client pattern), and RPCs aren't
// in its Functions map — so reads/rpcs go through an untyped service-role client.
function looseAdmin(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type StartCheckoutResult =
  | {
      ok: true;
      checkoutId: string;
      widget: { scriptUrl: string; brands: string[] };
      amount: number;
    }
  | { ok: false; error: string };

export async function startCheckout(input: {
  booking_id: string;
  cashback_redemption_sar?: number;
}): Promise<StartCheckoutResult> {
  if (isPaymentsDisabled()) return { ok: false, error: 'flag_disabled' };
  const session = await requireClientSession();
  const admin = looseAdmin();

  // Optional cashback redemption — must happen BEFORE payment. Idempotent per
  // booking: a retry where redemption was already applied is treated as OK.
  const redeem = input.cashback_redemption_sar ?? 0;
  if (redeem > 0) {
    const { data, error } = await admin.rpc('redeem_cashback_for_booking', {
      p_client_id: session.client_id,
      p_booking_id: input.booking_id,
      p_redemption_amount: redeem,
    });
    if (error) return { ok: false, error: 'rpc_failed' };
    const r = data as { ok: boolean; error?: string };
    if (!r.ok && r.error !== 'already_redeemed_for_booking') {
      return { ok: false, error: r.error ?? 'redeem_failed' };
    }
  }

  const { data: bk, error: bkErr } = await admin
    .from('bookings')
    .select(
      'client_id, payment_status, paid_at, total_amount, cashback_redemption_sar, booking_number'
    )
    .eq('id', input.booking_id)
    .maybeSingle();
  if (bkErr || !bk) return { ok: false, error: 'booking_not_found' };
  const b = bk as {
    client_id: string;
    payment_status: string;
    paid_at: string | null;
    total_amount: number | string;
    cashback_redemption_sar: number | string | null;
    booking_number: string;
  };
  if (b.client_id !== session.client_id) return { ok: false, error: 'not_owner' };
  if (b.paid_at || b.payment_status === 'paid') {
    return { ok: false, error: 'already_paid' };
  }
  const amount = Number(b.total_amount) - Number(b.cashback_redemption_sar ?? 0);
  if (!(amount > 0)) return { ok: false, error: 'nothing_to_pay' };

  const provider = getPaymentProvider();
  const checkout = await provider.createCheckout({
    merchantRef: b.booking_number,
    amount,
    currency: 'SAR',
  });
  if (!checkout.ok) return { ok: false, error: checkout.error };

  // Authoritative re-validation + persists checkout_id on the payment row.
  const attempt = await createPaymentAttempt({
    bookingId: input.booking_id,
    clientId: session.client_id,
    provider: provider.name,
    checkoutId: checkout.checkoutId,
    idempotencyKey: null,
  });
  if (!attempt.ok) return { ok: false, error: attempt.error };

  return {
    ok: true,
    checkoutId: checkout.checkoutId,
    widget: checkout.widget,
    amount: attempt.amount,
  };
}

export type ConfirmCheckoutResult =
  | { ok: true; outcome: 'success' | 'pending'; bookingId?: string }
  | { ok: false; error: string };

export async function confirmCheckout(input: {
  checkout_id: string;
}): Promise<ConfirmCheckoutResult> {
  if (isPaymentsDisabled()) return { ok: false, error: 'flag_disabled' };
  const session = await requireClientSession();

  // Source of truth: server-side status lookup (NOT a webhook payload).
  const provider = getPaymentProvider();
  const status = await provider.getPaymentStatus(input.checkout_id);
  if (!status.ok) return { ok: false, error: status.error };

  const pay = await findPaymentByCheckoutId(input.checkout_id);
  if (!pay) return { ok: false, error: 'payment_not_found' };

  // Ownership re-check before any confirmation.
  const admin = looseAdmin();
  const { data: bk } = await admin
    .from('bookings')
    .select('client_id')
    .eq('id', pay.booking_id)
    .maybeSingle();
  if (!bk || (bk as { client_id: string }).client_id !== session.client_id) {
    return { ok: false, error: 'not_owner' };
  }

  if (status.outcome === 'success') {
    const r = await confirmBookingPayment({
      paymentId: pay.id,
      providerTxn: status.providerTxn,
      providerStatus: status.resultCode,
      method: status.method,
      raw: status.raw,
    });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, outcome: 'success', bookingId: r.booking_id };
  }
  if (status.outcome === 'pending') {
    return { ok: true, outcome: 'pending' };
  }
  await failPaymentAttempt({
    paymentId: pay.id,
    providerStatus: status.resultCode,
    raw: status.raw,
  });
  return { ok: false, error: 'payment_failed' };
}
