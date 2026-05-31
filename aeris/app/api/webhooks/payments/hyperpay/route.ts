import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { getPaymentProvider } from '@/lib/payments/provider';
import { recordPaymentEvent } from '@/lib/payments/payments';

/**
 * HyperPay payment webhook (PR1 — FAIL-CLOSED, processing DEFERRED).
 *
 * Until the REAL HyperPay notification verifier is wired against the live
 * merchant spec, this route does NOT trust, persist, or act on any payload:
 * an unverified request gets 503 and writes nothing (no DB/storage-abuse
 * surface for anonymous callers). Payment confirmation is driven exclusively
 * by the server-side status lookup in confirmCheckout(). When the verifier
 * lands, the verified branch below records the event (keyed off the verified
 * provider event id) and then processes via status-lookup → confirm.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const MAX_WEBHOOK_BYTES = 64 * 1024; // 64 KiB

export async function POST(req: NextRequest): Promise<Response> {
  // Size cap BEFORE reading/parsing — reject oversized bodies outright.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
  }
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
  }

  const provider = getPaymentProvider();
  const verdict = provider.verifyWebhook(rawBody, req.headers);

  // FAIL-CLOSED: unverified → no write, no processing.
  if (!verdict.verified) {
    console.warn(
      '[webhooks.payments.hyperpay] unverified webhook rejected',
      verdict.reason
    );
    return NextResponse.json(
      { ok: false, error: 'verifier_not_configured' },
      { status: 503 }
    );
  }

  // Verified path (active once the verifier lands): record the event, then
  // confirm via status lookup (never trust the payload's amounts directly).
  let parsed: unknown;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const eventKey = `${provider.name}:${createHash('sha256').update(rawBody).digest('hex')}`;
  await recordPaymentEvent({
    provider: provider.name,
    providerEventKey: eventKey,
    providerEventId: null,
    paymentId: null,
    bookingId: null,
    eventType: 'webhook',
    raw: parsed,
    signatureVerified: true,
  });
  return NextResponse.json({ ok: true, processed: false }, { status: 200 });
}
