'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { getPaymentProvider } from '@/lib/payments/provider';
import {
  createPaymentAttempt,
  claimPaymentCheckoutCreation,
  releasePaymentCheckoutClaim,
  attachPaymentCheckout,
  confirmBookingPayment,
  failPaymentAttempt,
  findPaymentByCheckoutId,
} from '@/lib/payments/payments';

/**
 * Phase: payments PR1 — client checkout Server Actions.
 *
 * startCheckout: (optional cashback redeem, pre-payment) → open/reuse the
 * INTERNAL attempt FIRST (derives + validates net amount, owns idempotency via
 * a caller uuid) → only then create the gateway checkout and attach its id, so
 * a gateway failure can never orphan an external checkout.
 * confirmCheckout: status-lookup-first — the gateway's server-side status is
 * the source of truth; on success confirm_booking_payment re-checks the
 * gateway amount/currency and flips the booking to paid (existing triggers
 * cascade cashback/tier/referral).
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
  idempotency_key: string;
  cashback_redemption_sar?: number;
}): Promise<StartCheckoutResult> {
  if (isPaymentsDisabled()) return { ok: false, error: 'flag_disabled' };
  if (!input.idempotency_key?.trim()) {
    return { ok: false, error: 'idempotency_key_required' };
  }
  const session = await requireClientSession();

  // Optional cashback redemption — must happen BEFORE payment. Idempotent per
  // booking: a retry where redemption was already applied is treated as OK.
  const redeem = input.cashback_redemption_sar ?? 0;
  if (redeem > 0) {
    const { data, error } = await looseAdmin().rpc('redeem_cashback_for_booking', {
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

  const provider = getPaymentProvider();

  // 1) Open/reuse the INTERNAL attempt first — validates ownership + unpaid,
  //    derives the net amount, and owns idempotency. No gateway call yet.
  const attempt = await createPaymentAttempt({
    bookingId: input.booking_id,
    clientId: session.client_id,
    provider: provider.name,
    idempotencyKey: input.idempotency_key,
  });
  if (!attempt.ok) return { ok: false, error: attempt.error };

  // 2) A reused attempt that already has a checkout → return its widget (dedup
  //    a duplicate init; no second external checkout).
  if (attempt.checkout_id) {
    return {
      ok: true,
      checkoutId: attempt.checkout_id,
      widget: provider.widgetConfig(attempt.checkout_id),
      amount: attempt.amount,
    };
  }

  // 3) Single-flight claim — only the winner calls the gateway, so concurrent
  //    inits with the same key can't each create an orphan external checkout.
  const claim = await claimPaymentCheckoutCreation({ paymentId: attempt.payment_id });
  if (!claim.ok) return { ok: false, error: 'checkout_pending' };

  // 4) Create the gateway checkout for the DERIVED amount, then attach its id.
  //    On gateway failure, release the claim so a retry can re-create it.
  const checkout = await provider.createCheckout({
    merchantRef: attempt.booking_number,
    amount: attempt.amount,
    currency: 'SAR',
  });
  if (!checkout.ok) {
    await releasePaymentCheckoutClaim({ paymentId: attempt.payment_id });
    return { ok: false, error: checkout.error };
  }

  const attach = await attachPaymentCheckout({
    paymentId: attempt.payment_id,
    checkoutId: checkout.checkoutId,
  });
  if (!attach.ok) return { ok: false, error: attach.error };

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

  // 1) Resolve the checkout to an INTERNAL payment and verify ownership BEFORE
  //    hitting the gateway — an authenticated client must not be able to force
  //    a status lookup for a checkout it does not own.
  const pay = await findPaymentByCheckoutId(input.checkout_id);
  if (!pay) return { ok: false, error: 'payment_not_found' };

  const admin = looseAdmin();
  const { data: bk } = await admin
    .from('bookings')
    .select('client_id')
    .eq('id', pay.booking_id)
    .maybeSingle();
  if (!bk || (bk as { client_id: string }).client_id !== session.client_id) {
    return { ok: false, error: 'not_owner' };
  }

  // 2) Source of truth: server-side status lookup (NOT a webhook payload).
  const provider = getPaymentProvider();
  const status = await provider.getPaymentStatus(input.checkout_id);
  if (!status.ok) return { ok: false, error: status.error };

  if (status.outcome === 'success') {
    const r = await confirmBookingPayment({
      paymentId: pay.id,
      providerTxn: status.providerTxn,
      providerStatus: status.resultCode,
      method: status.method,
      providerAmount: status.amount,
      providerCurrency: status.currency,
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
