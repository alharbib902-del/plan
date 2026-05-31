import 'server-only';

import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  PaymentOutcome,
  StatusResult,
  WebhookVerifyResult,
} from './provider';

/**
 * HyperPay COPYandPAY provider (PR1).
 *
 * Built to the public COPYandPAY API (server creates a checkout → hosted
 * widget collects the card/wallet → we confirm via a server-side status
 * lookup). NOT live-tested yet — no merchant credentials. Two deliberate
 * constraints from the plan review:
 *   - verifyWebhook is NOT implemented (returns verified:false) until the
 *     real merchant notification spec is pinned — the webhook route must not
 *     act on an unverified payload; confirmation goes through getPaymentStatus.
 *   - When env credentials are absent, gateway calls fail-closed with
 *     'payment_not_configured' instead of hitting the network with junk.
 */

function cfg() {
  const accessToken = process.env.HYPERPAY_ACCESS_TOKEN;
  // COPYandPAY: a single entity drives the hosted widget. mada/Apple-Pay
  // entity routing is finalised with the live merchant profile; PR1 uses the
  // cards entity as the default and exposes the brand list to the widget.
  const entityId = process.env.HYPERPAY_ENTITY_ID_VISA;
  const mode = (process.env.HYPERPAY_MODE ?? 'test').trim().toLowerCase();
  const base =
    mode === 'live' ? 'https://eu-prod.oppwa.com' : 'https://eu-test.oppwa.com';
  return { accessToken, entityId, base };
}

const SUCCESS_RE = /^(000\.000\.|000\.100\.1|000\.[36])/;
const PENDING_RE = /^(000\.200|800\.400\.5|100\.400\.500)/;

function classify(code: string | null): PaymentOutcome {
  if (!code) return 'failed';
  if (SUCCESS_RE.test(code)) return 'success';
  if (PENDING_RE.test(code)) return 'pending';
  return 'failed';
}

const BRAND_TO_METHOD: Record<string, string> = {
  VISA: 'visa',
  MASTER: 'mastercard',
  MADA: 'mada',
  APPLEPAY: 'apple_pay',
  STC_PAY: 'stc_pay',
};

const WIDGET_BRANDS = ['VISA', 'MASTER', 'MADA', 'APPLEPAY'];

function widgetFor(base: string, checkoutId: string) {
  return {
    scriptUrl: `${base}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(checkoutId)}`,
    brands: WIDGET_BRANDS,
  };
}

export class HyperPayProvider implements PaymentProvider {
  readonly name = 'hyperpay';

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const { accessToken, entityId, base } = cfg();
    if (!accessToken || !entityId) {
      return { ok: false, error: 'payment_not_configured' };
    }
    const body = new URLSearchParams({
      entityId,
      amount: req.amount.toFixed(2),
      currency: req.currency,
      paymentType: 'DB',
      merchantTransactionId: req.merchantRef,
    });
    try {
      const res = await fetch(`${base}/v1/checkouts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });
      const data = (await res.json()) as {
        id?: string;
        result?: { code?: string };
      };
      const code = data.result?.code ?? null;
      if (!data.id || classify(code) === 'failed') {
        return { ok: false, error: `checkout_failed:${code ?? 'no_code'}` };
      }
      return { ok: true, checkoutId: data.id, widget: widgetFor(base, data.id) };
    } catch (err) {
      console.error('[hyperpay.createCheckout] error', err);
      return { ok: false, error: 'gateway_unreachable' };
    }
  }

  widgetConfig(checkoutId: string): { scriptUrl: string; brands: string[] } {
    return widgetFor(cfg().base, checkoutId);
  }

  async getPaymentStatus(checkoutId: string): Promise<StatusResult> {
    const { accessToken, entityId, base } = cfg();
    if (!accessToken || !entityId) {
      return { ok: false, error: 'payment_not_configured' };
    }
    try {
      const url = `${base}/v1/checkouts/${encodeURIComponent(checkoutId)}/payment?entityId=${encodeURIComponent(entityId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as {
        id?: string;
        paymentBrand?: string;
        amount?: string;
        currency?: string;
        result?: { code?: string };
      };
      const code = data.result?.code ?? null;
      return {
        ok: true,
        outcome: classify(code),
        providerTxn: data.id ?? null,
        method: data.paymentBrand
          ? (BRAND_TO_METHOD[data.paymentBrand.toUpperCase()] ?? null)
          : null,
        amount: data.amount ? Number(data.amount) : null,
        currency: data.currency ?? null,
        resultCode: code,
        raw: data,
      };
    } catch (err) {
      console.error('[hyperpay.getPaymentStatus] error', err);
      return { ok: false, error: 'gateway_unreachable' };
    }
  }

  verifyWebhook(_rawBody: string, _headers: Headers): WebhookVerifyResult {
    // DEFERRED: HyperPay's notification authentication (AES-decrypt of the
    // body with the configured key + IV/auth-tag, or the contracted scheme)
    // must be implemented against the REAL merchant spec. Until then we never
    // claim a webhook is authentic — the route falls back to status-lookup.
    return { verified: false, reason: 'hyperpay_webhook_verifier_not_configured' };
  }
}
