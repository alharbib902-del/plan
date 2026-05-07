'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminSession } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  CustomerTokenEnvError,
  hashCheckoutToken,
  mintCheckoutToken,
} from '@/lib/checkout/customer-token';

/**
 * Phase 6.2 PR 2b: admin "Issue customer checkout link" action.
 *
 * Spec S5: the customer checkout token is issued
 * **separately** by the founder via this admin button after
 * the WhatsApp coordination call — NOT synchronously with
 * accept_offer. PR 2a's accept_offer body INSERTs the
 * bookings row with `checkout_token_hash = NULL` and
 * `checkout_token_expires_at = NULL`. This action mints a
 * v=2 token, writes its SHA-256 hash + expiry to the
 * bookings row, and returns the raw token to the founder
 * once (so they can copy it into a WhatsApp message).
 *
 * Re-issuance: calling this action again on the same booking
 * mints a NEW token + writes a NEW hash. The OLD token's
 * signature still verifies, but the DB hash check fails
 * (Layer 2 of the three-layer customer-side validation),
 * so it's effectively revoked.
 *
 * Fail-closed posture per spec S5 + Codex iteration-3 P1 #3:
 *   - `mintCheckoutToken` throws `CustomerTokenEnvError`
 *     when `CUSTOMER_CHECKOUT_SECRET` is missing or empty.
 *     This action catches that and returns a clear
 *     `secret_not_set` error to the founder UI without
 *     touching the bookings row.
 *
 * Paired CHECK constraint
 * `bookings_checkout_token_pair_check` ensures the two
 * columns appear or vanish together, so this UPDATE writes
 * BOTH hash + expires_at in the same statement.
 */

const issueCheckoutLinkSchema = z.object({
  booking_id: z.string().uuid('booking_id_invalid'),
});

export type IssueCheckoutLinkActionResult =
  | {
      ok: true;
      /**
       * The raw token. Sent to the customer once via
       * WhatsApp + Email. The DB only stores its hash.
       */
      token: string;
      /** ISO 8601 expiry. Same value persisted to the DB. */
      expires_at: string;
      /** Full URL the founder copies into WhatsApp. */
      checkout_url: string;
    }
  | { ok: false; error: 'validation_failed' | 'booking_not_found' | 'secret_not_set' | 'rpc_failed' };

export async function issueCheckoutLink(input: {
  booking_id: string;
}): Promise<IssueCheckoutLinkActionResult> {
  await requireAdminSession();

  const parsed = issueCheckoutLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_failed' };
  }

  // Layer 1 (mint): if CUSTOMER_CHECKOUT_SECRET is unset,
  // catch the throw and surface `secret_not_set` to the
  // founder UI. No DB write. The bookings row's
  // `checkout_token_*` stay NULL (no half-issued state).
  let minted: ReturnType<typeof mintCheckoutToken>;
  try {
    minted = mintCheckoutToken({ bookingId: parsed.data.booking_id });
  } catch (err) {
    if (err instanceof CustomerTokenEnvError) {
      console.error('[admin/checkout-token] CUSTOMER_CHECKOUT_SECRET not set');
      return { ok: false, error: 'secret_not_set' };
    }
    throw err;
  }

  // Persist hash + expiry. The paired CHECK constraint
  // requires both columns to appear together — so we always
  // write both in the same UPDATE. SHA-256 hex of the raw
  // token (defense in depth: DB stores only the hash; the
  // raw token never persists).
  const tokenHash = hashCheckoutToken(minted.token);
  const expiresAtIso = new Date(minted.payload.exp * 1000).toISOString();

  const client = createAdminClient();
  const { error: updateError, count } = await client
    .from('bookings')
    .update(
      {
        checkout_token_hash: tokenHash,
        checkout_token_expires_at: expiresAtIso,
      },
      { count: 'exact' }
    )
    .eq('id', parsed.data.booking_id);

  if (updateError) {
    console.error('[admin/checkout-token] UPDATE error', updateError);
    return { ok: false, error: 'rpc_failed' };
  }
  if (count === 0) {
    return { ok: false, error: 'booking_not_found' };
  }

  // Build the public URL the founder copies. Phase 6.2's
  // checkout-prep route lives at `/booking/[token]/checkout-prep`
  // (one route group `(checkout)` away from app root). Use
  // NEXT_PUBLIC_SITE_URL when available, else relative.
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? '';
  const checkoutUrl = `${baseUrl}/booking/${minted.token}/checkout-prep`;

  revalidatePath(`/admin/trips/${parsed.data.booking_id}`);

  return {
    ok: true,
    token: minted.token,
    expires_at: expiresAtIso,
    checkout_url: checkoutUrl,
  };
}
