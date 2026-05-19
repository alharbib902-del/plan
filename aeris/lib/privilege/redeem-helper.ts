import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Phase 13 PR 3 — shared cashback redemption helper for the
 * charter/cargo/medevac accept actions.
 *
 * Wraps the §4.4 `redeem_cashback_for_booking` RPC so each
 * accept action's wiring is a one-liner. The accept itself
 * always succeeds (booking is created); cashback failure is
 * surfaced via the returned `cashback_redemption` field on the
 * action's success response.
 *
 * Why decoupling matters:
 *   - The booking accept RPC (`accept_offer`,
 *     `accept_cargo_offer`, `accept_medevac_offer`) is in its
 *     own transaction.
 *   - The redeem RPC is in its own transaction too.
 *   - If redeem fails (race with another booking that drained
 *     the balance, exceeded cap, etc.), the booking stays
 *     created. UI surfaces a `cashback_partial_failure` warning
 *     so the user knows their cash payment is full price.
 *   - The redeem RPC's `booking_already_paid` guard prevents
 *     this from ever paying twice (we redeem only against
 *     `payment_status='pending'` bookings, which the freshly
 *     created accept booking always is in Phase 13).
 *
 * Idempotency: the RPC itself is idempotent on the
 * `(booking_id, event_type='redeem')` UNIQUE INDEX — a retry
 * of this helper for the same booking returns
 * `{ ok: false, error: 'already_redeemed_for_booking' }`. The
 * accept-action callers pass this through to the UI as a soft
 * `cashback_redemption.error` field; the booking itself
 * already succeeded so the user sees the booking confirmation
 * plus a "redemption already applied" notice rather than a
 * hard accept failure.
 */

export type RedeemCashbackResult =
  | {
      ok: true;
      redeemed_sar: number;
      ledger_id: string;
      new_balance_sar: number;
    }
  | {
      ok: false;
      error:
        | 'redemption_amount_invalid'
        | 'already_redeemed_for_booking'
        | 'already_redeemed_for_booking_race'
        | 'booking_not_found_or_not_owned'
        | 'booking_already_paid'
        | 'client_not_found'
        | 'insufficient_balance'
        | 'redemption_exceeds_cap'
        | 'redemption_leaves_no_cash_payment'
        | 'rpc_failed'
        | 'flag_disabled';
      detail?: Record<string, unknown>;
    };

type LooseRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

/**
 * Calls `redeem_cashback_for_booking` only if the requested
 * amount is > 0 AND `ENABLE_PRIVILEGE === 'true'`. Returns
 * `null` if the redemption was not attempted (UI should treat
 * that the same as "no redemption requested"). Returns the
 * RPC envelope otherwise.
 *
 * The accept action calls this AFTER its own RPC returned a
 * `booking_id`. The RPC's `booking_already_paid` guard means
 * we never accidentally redeem against a paid booking; in
 * Phase 13 every freshly created booking is `payment_status='pending'`.
 */
// Phase 13 invariant: all current accept RPCs create bookings with
// bookings.total_amount = accepted_offer.total_price_sar before any
// Phase 14 addons/VAT recompute. UI redemption caps may preview from
// offer.total_price_sar, but the DB RPC remains the authority and
// re-validates against bookings.total_amount after accept.
export async function redeemCashbackIfRequested(args: {
  client_id: string;
  booking_id: string;
  cashback_redemption_sar?: number;
}): Promise<RedeemCashbackResult | null> {
  const amount = args.cashback_redemption_sar;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  if (process.env.ENABLE_PRIVILEGE !== 'true') {
    return { ok: false, error: 'flag_disabled' };
  }

  const admin = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await admin.rpc('redeem_cashback_for_booking', {
    p_client_id: args.client_id,
    p_booking_id: args.booking_id,
    p_redemption_amount: amount,
  });

  if (error) {
    console.error('[redeem-helper] rpc transport error', error);
    return { ok: false, error: 'rpc_failed' };
  }

  type Envelope =
    | {
        ok: true;
        redeemed_sar: number;
        ledger_id: string;
        new_balance_sar: number;
        booking_id: string;
      }
    | {
        ok: false;
        error: string;
        current_balance?: number;
        requested?: number;
        max_allowed?: number;
      };

  const envelope = (data ?? null) as Envelope | null;
  if (!envelope) {
    return { ok: false, error: 'rpc_failed' };
  }
  if (envelope.ok === true) {
    return {
      ok: true,
      redeemed_sar: envelope.redeemed_sar,
      ledger_id: envelope.ledger_id,
      new_balance_sar: envelope.new_balance_sar,
    };
  }

  // Map structured RPC errors to the typed union. Unknown
  // strings fall through to `rpc_failed` so callers can rely
  // on the union without exhaustive runtime checks.
  const KNOWN_ERRORS = [
    'redemption_amount_invalid',
    'already_redeemed_for_booking',
    'already_redeemed_for_booking_race',
    'booking_not_found_or_not_owned',
    'booking_already_paid',
    'client_not_found',
    'insufficient_balance',
    'redemption_exceeds_cap',
    'redemption_leaves_no_cash_payment',
  ] as const;
  type KnownError = (typeof KNOWN_ERRORS)[number];

  if ((KNOWN_ERRORS as readonly string[]).includes(envelope.error)) {
    const detail: Record<string, unknown> = {};
    if (typeof envelope.current_balance === 'number') {
      detail.current_balance = envelope.current_balance;
    }
    if (typeof envelope.requested === 'number') {
      detail.requested = envelope.requested;
    }
    if (typeof envelope.max_allowed === 'number') {
      detail.max_allowed = envelope.max_allowed;
    }
    return {
      ok: false,
      error: envelope.error as KnownError,
      ...(Object.keys(detail).length > 0 ? { detail } : {}),
    };
  }
  return { ok: false, error: 'rpc_failed' };
}
