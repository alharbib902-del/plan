'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOperatorSession } from '@/lib/operators/auth';
import { cargoOfferSchema } from '@/lib/cargo/validators/cargo-offer';
import { withdrawOfferSchema } from '@/lib/cargo/validators/cargo-actions';
import { fieldErrorsFromZod } from '@/lib/validators/field-errors';

/**
 * Phase 11 PR 2 — operator cargo Server Actions.
 *
 * 2 actions (per spec §3.2):
 *   - submitCargoOffer → wraps §4.3 submit_cargo_offer
 *   - withdrawMyCargoOffer → wraps §4.5 withdraw_cargo_offer
 *
 * Both actions follow the Phase 8 / Phase 10 operator action
 * discipline:
 *   1. requireOperatorSession() — re-validates the cookie
 *      every call so a mid-session suspend / password-reset
 *      propagates immediately.
 *   2. **password_must_change guard** (Round 2 PR #66 P1 #1).
 *      Mirror the operators-empty-legs-authed.ts pattern: if
 *      `session.password_must_change` is true, return
 *      `must_change_password_first` immediately. The /operator
 *      authed layout already redirects such sessions to
 *      /operator/profile/password, but Server Actions can be
 *      invoked from any client surface (direct POST, stale
 *      tab, etc.) so this MUST also reject. Without it, an
 *      operator coming from welcome / admin-reset could submit
 *      or withdraw cargo offers before setting a new password.
 *   3. Honour ENABLE_CARGO flag (fail-closed).
 *   4. Zod-validate input.
 *   5. Call the SECURITY DEFINER RPC; the RPC enforces all
 *      business rules (capability match, request open, offer
 *      ownership, etc.).
 *   6. Revalidate /operator/cargo paths on success.
 */

export type CargoOperatorActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isCargoDisabled(): boolean {
  return process.env.ENABLE_CARGO !== 'true';
}

type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

function looseClient(): LooseRpcClient {
  return createAdminClient() as unknown as LooseRpcClient;
}

// ============================================================
// 1. submitCargoOffer → §4.3 submit_cargo_offer
// ============================================================

export type SubmitCargoOfferResult =
  | {
      ok: true;
      offer_id: string;
      total_price_sar: number;
      expires_at: string;
    }
  | CargoOperatorActionFailure;

export async function submitCargoOffer(
  input: unknown
): Promise<SubmitCargoOfferResult> {
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireOperatorSession();

  // Round 2 PR #66 P1 #1 — password_must_change defense-in-depth.
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = cargoOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('submit_cargo_offer', {
    p_cargo_request_id: parsed.data.cargo_request_id,
    p_operator_id: session.operator_id,
    p_payload: parsed.data,
  });
  if (error) {
    console.error('[cargo-operators.submitOffer] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        offer_id: string;
        total_price_sar: number;
        expires_at: string;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/operator/cargo');
  revalidatePath('/operator/cargo/offers');
  revalidatePath(`/operator/cargo/${parsed.data.cargo_request_id}/offer`);
  // Also revalidate the matching client/admin views so the new
  // offer surfaces without manual reload.
  revalidatePath('/admin/cargo');

  return {
    ok: true,
    offer_id: result.offer_id,
    total_price_sar: result.total_price_sar,
    expires_at: result.expires_at,
  };
}

// ============================================================
// 2. withdrawMyCargoOffer → §4.5 withdraw_cargo_offer
// ============================================================

export type WithdrawMyCargoOfferResult =
  | { ok: true; offer_id: string; already_withdrawn?: boolean }
  | CargoOperatorActionFailure;

export async function withdrawMyCargoOffer(input: {
  offer_id: string;
  reason?: string;
}): Promise<WithdrawMyCargoOfferResult> {
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireOperatorSession();

  // Round 2 PR #66 P1 #1 — password_must_change defense-in-depth.
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = withdrawOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('withdraw_cargo_offer', {
    p_offer_id: parsed.data.offer_id,
    p_operator_id: session.operator_id,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[cargo-operators.withdraw] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; offer_id: string; already_withdrawn?: boolean }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/operator/cargo/offers');

  return {
    ok: true,
    offer_id: result.offer_id,
    already_withdrawn: result.already_withdrawn,
  };
}
