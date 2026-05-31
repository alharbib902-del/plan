import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase: payments PR1 — service-role wrappers for the payment-core RPCs.
 * The RPCs (SECURITY DEFINER, service_role-only) own all validation +
 * ownership + the atomic paid transition. Not in types/database.ts → loose
 * accessors (Phase 8 PR 2e inference lesson).
 */

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function looseRpc(): LooseRpcClient {
  return createAdminClient() as unknown as LooseRpcClient;
}

function looseDb(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

export type RpcResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export async function createPaymentAttempt(args: {
  bookingId: string;
  clientId: string;
  provider: string;
  idempotencyKey: string;
}): Promise<
  RpcResult<{
    payment_id: string;
    amount: number;
    booking_number: string;
    checkout_id: string | null;
    reused: boolean;
  }>
> {
  const { data, error } = await looseRpc().rpc('create_payment_attempt', {
    p_booking_id: args.bookingId,
    p_client_id: args.clientId,
    p_provider: args.provider,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) {
    console.error('[payments.createPaymentAttempt] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return data as RpcResult<{
    payment_id: string;
    amount: number;
    booking_number: string;
    checkout_id: string | null;
    reused: boolean;
  }>;
}

/** Single-flight: atomically claims the right to create the gateway checkout,
 *  returning a per-claim token that attach/release must echo back. */
export async function claimPaymentCheckoutCreation(args: {
  paymentId: string;
}): Promise<RpcResult<{ token: string }>> {
  const { data, error } = await looseRpc().rpc('claim_payment_checkout_creation', {
    p_payment_id: args.paymentId,
  });
  if (error) {
    console.error('[payments.claimPaymentCheckoutCreation] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return data as RpcResult<{ token: string }>;
}

/** Releases one's OWN checkout-creation claim (token) after a gateway failure. */
export async function releasePaymentCheckoutClaim(args: {
  paymentId: string;
  token: string;
}): Promise<RpcResult> {
  const { data, error } = await looseRpc().rpc('release_payment_checkout_claim', {
    p_payment_id: args.paymentId,
    p_token: args.token,
  });
  if (error) {
    console.error('[payments.releasePaymentCheckoutClaim] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return data as RpcResult;
}

/** Attaches the gateway checkout id to one's OWN claimed attempt (token). */
export async function attachPaymentCheckout(args: {
  paymentId: string;
  checkoutId: string;
  token: string;
}): Promise<RpcResult> {
  const { data, error } = await looseRpc().rpc('attach_payment_checkout', {
    p_payment_id: args.paymentId,
    p_checkout_id: args.checkoutId,
    p_token: args.token,
  });
  if (error) {
    console.error('[payments.attachPaymentCheckout] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return data as RpcResult;
}

export async function confirmBookingPayment(args: {
  paymentId: string;
  providerTxn: string | null;
  providerStatus: string | null;
  method: string | null;
  providerAmount: string | null;
  providerCurrency: string | null;
  raw: unknown;
}): Promise<RpcResult<{ booking_id: string; already?: boolean }>> {
  const { data, error } = await looseRpc().rpc('confirm_booking_payment', {
    p_payment_id: args.paymentId,
    p_provider_txn: args.providerTxn,
    p_provider_status: args.providerStatus,
    p_method: args.method,
    p_provider_amount: args.providerAmount,
    p_provider_currency: args.providerCurrency,
    p_raw: args.raw,
  });
  if (error) {
    console.error('[payments.confirmBookingPayment] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return data as RpcResult<{ booking_id: string; already?: boolean }>;
}

export async function failPaymentAttempt(args: {
  paymentId: string;
  providerStatus: string | null;
  raw: unknown;
}): Promise<RpcResult> {
  const { data, error } = await looseRpc().rpc('fail_payment_attempt', {
    p_payment_id: args.paymentId,
    p_provider_status: args.providerStatus,
    p_raw: args.raw,
  });
  if (error) {
    console.error('[payments.failPaymentAttempt] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return data as RpcResult;
}

/** Returns the new event id, or null if the key was already recorded. */
export async function recordPaymentEvent(args: {
  provider: string;
  providerEventKey: string;
  providerEventId: string | null;
  paymentId: string | null;
  bookingId: string | null;
  eventType: string | null;
  raw: unknown;
  signatureVerified: boolean;
}): Promise<string | null> {
  const { data, error } = await looseRpc().rpc('record_payment_event', {
    p_provider: args.provider,
    p_provider_event_key: args.providerEventKey,
    p_provider_event_id: args.providerEventId,
    p_payment_id: args.paymentId,
    p_booking_id: args.bookingId,
    p_event_type: args.eventType,
    p_raw: args.raw,
    p_signature_verified: args.signatureVerified,
  });
  if (error) {
    console.error('[payments.recordPaymentEvent] rpc error', error);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

export type PaymentLookupRow = { id: string; booking_id: string };

export async function findPaymentByCheckoutId(
  checkoutId: string
): Promise<PaymentLookupRow | null> {
  const { data, error } = await looseDb()
    .from('payments')
    .select('id, booking_id')
    .eq('checkout_id', checkoutId)
    .maybeSingle();
  if (error) {
    console.error('[payments.findPaymentByCheckoutId] error', error);
    return null;
  }
  return (data as PaymentLookupRow | null) ?? null;
}
