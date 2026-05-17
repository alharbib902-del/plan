'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOperatorSession } from '@/lib/operators/auth';
import { medevacOfferSchema } from '@/lib/medevac/validators/medevac-offer';
import { withdrawOfferSchema } from '@/lib/medevac/validators/medevac-actions';

/**
 * Phase 12 PR 2 — operator-side medevac Server Actions.
 *
 * 2 actions:
 *   - submitMedevacOffer → wraps §4.3 submit_medevac_offer
 *   - withdrawMyMedevacOffer → wraps §4.5 withdraw_medevac_offer
 *
 * Mirrors Phase 11 cargo-operators discipline:
 *   1. requireOperatorSession() — re-validates cookie every call
 *   2. password_must_change guard (Round 2 PR #66 P1 #1 pattern)
 *   3. ENABLE_MEDEVAC flag gate (fail-closed)
 *   4. Zod validation
 *   5. SECURITY DEFINER RPC call (enforces capability match,
 *      cert-expiry gate, ownership, etc.)
 *   6. revalidatePath('/operator/medevac*') on success
 */

export type MedevacOperatorActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isMedevacDisabled(): boolean {
  return process.env.ENABLE_MEDEVAC !== 'true';
}

function fieldErrorsFromZod(
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.');
    if (path) out[path] = issue.message;
  }
  return out;
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
// 1. submitMedevacOffer → §4.3 submit_medevac_offer
// ============================================================

export type SubmitMedevacOfferResult =
  | { ok: true; medevac_offer_id: string }
  | MedevacOperatorActionFailure;

export async function submitMedevacOffer(
  input: unknown
): Promise<SubmitMedevacOfferResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireOperatorSession();

  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = medevacOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('submit_medevac_offer', {
    p_operator_id: session.operator_id,
    p_payload: parsed.data,
  });
  if (error) {
    console.error('[medevac-operators.submitOffer] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; medevac_offer_id: string }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/operator/medevac');
  revalidatePath(`/operator/medevac/${parsed.data.medevac_request_id}/offer`);
  revalidatePath('/operator/medevac/offers');
  revalidatePath('/admin/medevac');

  return { ok: true, medevac_offer_id: result.medevac_offer_id };
}

// ============================================================
// 2. withdrawMyMedevacOffer → §4.5 withdraw_medevac_offer
// ============================================================

export type WithdrawMyMedevacOfferResult =
  | { ok: true; offer_id: string; already_withdrawn?: boolean }
  | MedevacOperatorActionFailure;

export async function withdrawMyMedevacOffer(input: {
  offer_id: string;
  reason?: string;
}): Promise<WithdrawMyMedevacOfferResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireOperatorSession();

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
  const { data, error } = await client.rpc('withdraw_medevac_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_operator_id: session.operator_id,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[medevac-operators.withdraw] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; offer_id: string; already_withdrawn?: boolean }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/operator/medevac');
  revalidatePath('/operator/medevac/offers');
  revalidatePath('/admin/medevac');

  return {
    ok: true,
    offer_id: result.offer_id,
    already_withdrawn: result.already_withdrawn,
  };
}
