import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { getPaymentProvider } from '@/lib/payments/provider';
import { recordPaymentEvent } from '@/lib/payments/payments';

/**
 * HyperPay payment webhook (PR1 — processing intentionally DEFERRED).
 *
 * Per the plan review: we do NOT act on a webhook until the REAL HyperPay
 * notification verifier is wired against the live merchant spec. Until then
 * this route only RECORDS the raw event (idempotent, signature_verified=false)
 * for audit/replay, and acknowledges (200) to avoid retry storms. Payment
 * confirmation is driven exclusively by the server-side status lookup in
 * confirmCheckout(). When the verifier lands, this route gains: verify →
 * match payment → status-lookup → confirm.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();
  const provider = getPaymentProvider();
  const verdict = provider.verifyWebhook(rawBody, req.headers);

  // Idempotency key: derived from the raw body until a verified provider event
  // id is available (verifier deferred), so duplicate deliveries collapse.
  const eventKey = `${provider.name}:${createHash('sha256').update(rawBody).digest('hex')}`;
  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsed = { unparsed: rawBody.slice(0, 2000) };
  }

  await recordPaymentEvent({
    provider: provider.name,
    providerEventKey: eventKey,
    providerEventId: null,
    paymentId: null,
    bookingId: null,
    eventType: 'webhook',
    raw: parsed,
    signatureVerified: verdict.verified,
  });

  if (!verdict.verified) {
    console.warn(
      '[webhooks.payments.hyperpay] unverified webhook stored; processing deferred',
      verdict.reason
    );
    return NextResponse.json(
      { ok: true, processed: false, reason: 'verifier_not_configured' },
      { status: 200 }
    );
  }

  // Verifier wired in a later PR: parse → match payment → status-lookup → confirm.
  return NextResponse.json({ ok: true, processed: false }, { status: 200 });
}
