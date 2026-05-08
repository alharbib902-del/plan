'use server';

import { revalidatePath } from 'next/cache';

import { requireAdminSession } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  adminCreateOperatorStubSchema,
  adminMintOperatorSessionSchema,
} from '@/lib/validators/empty-legs';
import {
  insertOperatorEmptyLegSession,
} from '@/lib/operator/empty-leg-session-store';
import {
  mintEmptyLegSessionToken,
} from '@/lib/operator/empty-leg-session-token';
import type { Phase7OperatorStubRow } from '@/lib/empty-legs/types';

/**
 * Phase 7 PR 2c — admin Server Actions for the operator-
 * portal bootstrap surface.
 *
 * Two actions:
 *   1. adminCreatePhase7OperatorStub — INSERT a new
 *      `phase7_operator_stubs` row. The dedicated stub
 *      table avoids touching the real `operators` table
 *      whose schema requires `user_id` + `commercial_
 *      registration` + `gaca_license` + `license_expiry`
 *      (Codex iteration-11 P1 #1 fix's prescribed second
 *      option).
 *   2. adminMintOperatorSession — issue a fresh HMAC
 *      session token bound to a known stub id, INSERT
 *      the hash into `operator_empty_leg_sessions`, and
 *      return the raw token + URL once. The DB never
 *      persists the raw token (mirror Phase 6.2's
 *      checkout_token_hash discipline).
 */

export type AdminStubActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

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

function isAdminFlagDisabled(): boolean {
  return process.env.ENABLE_EMPTY_LEGS_ADMIN_UI === 'false';
}

// ============================================================
// 1. adminCreatePhase7OperatorStub
// ============================================================

export type AdminCreatePhase7OperatorStubActionResult =
  | { ok: true; stub: Phase7OperatorStubRow }
  | AdminStubActionFailure;

export async function adminCreatePhase7OperatorStub(input: {
  company_name: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}): Promise<AdminCreatePhase7OperatorStubActionResult> {
  requireAdminSession();
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminCreateOperatorStubSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  const v = parsed.data;

  const client = createAdminClient();
  const { data, error } = await client
    .from('phase7_operator_stubs')
    .insert({
      company_name: v.company_name,
      contact_email: v.contact_email ?? null,
      contact_phone: v.contact_phone ?? null,
      notes: v.notes ?? null,
      status: 'active',
    })
    .select('*')
    .single();

  if (error) {
    console.error(
      '[phase7-operator-stubs.adminCreatePhase7OperatorStub] insert error',
      error
    );
    return { ok: false, error: 'insert_failed' };
  }

  revalidatePath('/admin/empty-legs/operators');
  revalidatePath('/admin/empty-legs/operator-sessions');
  return { ok: true, stub: data as Phase7OperatorStubRow };
}

// ============================================================
// 2. adminMintOperatorSession
// ============================================================

export type AdminMintOperatorSessionActionResult =
  | {
      ok: true;
      operator_stub_id: string;
      raw_token: string;
      portal_url: string;
      expires_at: string;
    }
  | AdminStubActionFailure;

const PORTAL_URL_PREFIX = '/operator/empty-legs/';

export async function adminMintOperatorSession(input: {
  operator_stub_id: string;
}): Promise<AdminMintOperatorSessionActionResult> {
  requireAdminSession();
  if (isAdminFlagDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = adminMintOperatorSessionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // Defense in depth: confirm the stub exists and is active
  // before minting. The DB FK would also reject an orphan
  // session row, but a structured error is friendlier.
  const client = createAdminClient();
  const { data: stub, error: stubErr } = await client
    .from('phase7_operator_stubs')
    .select('id, status')
    .eq('id', parsed.data.operator_stub_id)
    .maybeSingle();

  if (stubErr) {
    console.error(
      '[phase7-operator-stubs.adminMintOperatorSession] stub lookup error',
      stubErr
    );
    return { ok: false, error: 'rpc_failed' };
  }
  if (!stub || stub.status !== 'active') {
    return { ok: false, error: 'operator_stub_not_found' };
  }

  let minted;
  try {
    minted = mintEmptyLegSessionToken({
      operatorStubId: parsed.data.operator_stub_id,
    });
  } catch (err) {
    console.error(
      '[phase7-operator-stubs.adminMintOperatorSession] token mint failed',
      err
    );
    return { ok: false, error: 'token_mint_failed' };
  }

  const expiresAt = new Date(minted.payload.expires_at * 1000);

  try {
    await insertOperatorEmptyLegSession({
      operatorStubId: parsed.data.operator_stub_id,
      rawToken: minted.token,
      expiresAt,
    });
  } catch (err) {
    console.error(
      '[phase7-operator-stubs.adminMintOperatorSession] session insert failed',
      err
    );
    return { ok: false, error: 'insert_failed' };
  }

  revalidatePath('/admin/empty-legs/operator-sessions');

  return {
    ok: true,
    operator_stub_id: parsed.data.operator_stub_id,
    raw_token: minted.token,
    portal_url: `${PORTAL_URL_PREFIX}${minted.token}`,
    expires_at: expiresAt.toISOString(),
  };
}
