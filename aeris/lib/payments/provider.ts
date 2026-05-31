import 'server-only';

import { HyperPayProvider } from './hyperpay';

/**
 * Phase: payments PR1 — gateway-agnostic PaymentProvider interface.
 *
 * The app talks to gateways ONLY through this interface so HyperPay (PR1) and
 * Moyasar (later) are swappable behind one env-selected implementation. The
 * confirmation path is status-lookup-first: `getPaymentStatus` (a server-side
 * query to the gateway) is the source of truth for marking a booking paid —
 * never the webhook payload alone.
 */

export type CheckoutRequest = {
  merchantRef: string; // our merchant transaction reference (booking number)
  amount: number; // net payable (SAR), already minus cashback redemption
  currency: string; // 'SAR'
};

export type CheckoutResult =
  | {
      ok: true;
      checkoutId: string;
      // Everything the client page needs to mount the hosted widget.
      widget: { scriptUrl: string; brands: string[] };
    }
  | { ok: false; error: string };

export type PaymentOutcome = 'success' | 'pending' | 'failed';

export type StatusResult =
  | {
      ok: true;
      outcome: PaymentOutcome;
      providerTxn: string | null;
      method: string | null; // mapped to our payment_method enum, or null
      amount: number | null;
      currency: string | null;
      resultCode: string | null;
      raw: unknown;
    }
  | { ok: false; error: string };

export type WebhookVerifyResult = {
  verified: boolean;
  reason?: string;
  payload?: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Server-side authoritative status lookup (the confirmation source). */
  getPaymentStatus(checkoutId: string): Promise<StatusResult>;
  /**
   * Verify a webhook's authenticity from the RAW body + headers, per the
   * gateway's REAL spec. Until that spec is pinned for the live merchant,
   * an implementation MUST return { verified:false } so the webhook route
   * refuses to act on it (status-lookup remains the source of truth).
   */
  verifyWebhook(rawBody: string, headers: Headers): WebhookVerifyResult;
}

let cached: PaymentProvider | null = null;

/** Env-selected provider (PAYMENT_PROVIDER; defaults to hyperpay). */
export function getPaymentProvider(): PaymentProvider {
  if (cached) return cached;
  const name = (process.env.PAYMENT_PROVIDER ?? 'hyperpay').trim().toLowerCase();
  switch (name) {
    case 'hyperpay':
    default:
      cached = new HyperPayProvider();
      return cached;
  }
}
