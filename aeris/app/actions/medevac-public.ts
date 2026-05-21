'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { medevacRequestPublicSchema } from '@/lib/medevac/validators/medevac-request';
import {
  checkPublicActionRateLimit,
  recordPublicActionAttempt,
} from '@/lib/rate-limit/public-action';

/**
 * Phase 12 PR 1 — public medevac intake Server Action.
 *
 * Wraps §4.1 create_medevac_request_guest RPC. The /medevac
 * public form (anonymous browser, no session) submits its full
 * payload here; the action validates via Zod (which enforces
 * severity='stable' per D1), fetches the IP for the RPC's
 * defense-in-depth ip_required guard, and dispatches to the
 * SECURITY DEFINER function.
 *
 * Gated behind ENABLE_MEDEVAC env flag (fail-closed). When
 * unset or false, the public /medevac route 404s AND this
 * action returns flag_disabled — defense-in-depth so a leaked
 * deployment with the flag off can't accept submissions via
 * direct RPC invocation.
 *
 * PR 2 will add medevac-clients.ts with submitMedevacRequestAuthed
 * wrapping §4.2 create_medevac_request_authenticated.
 */

export type MedevacPublicActionFailure = {
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

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const xf = h.get('x-forwarded-for');
    if (xf) return xf.split(',')[0]!.trim();
    const xr = h.get('x-real-ip');
    if (xr) return xr.trim();
    return null;
  } catch {
    return null;
  }
}

// Loose-typed RPC client (Phase 9 convention #15 — RPC not
// registered in Functions map yet; preserves Supabase JS
// internal `this` binding).
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
// submitMedevacRequestPublic — wraps §4.1 RPC
// ============================================================

export type SubmitMedevacRequestPublicResult =
  | {
      ok: true;
      medevac_request_id: string;
      medevac_request_number: string;
    }
  | MedevacPublicActionFailure;

export async function submitMedevacRequestPublic(
  input: unknown
): Promise<SubmitMedevacRequestPublicResult> {
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  // 0. Rate-limit gate (per-IP, 5 failures/15min, 20 attempts/hr —
  // slightly more permissive than cargo since medevac is emergency-
  // adjacent and a panicked retry shouldn't lock the user out).
  const rl = await checkPublicActionRateLimit('medevac_intake');
  if (!rl.ok) {
    if (rl.reason !== 'storage_error' && rl.reason !== 'secret_missing') {
      await recordPublicActionAttempt(
        'medevac_intake',
        rl.actorFingerprint,
        'rate_limited'
      );
    }
    return { ok: false, error: 'rate_limited' };
  }

  // 1. Zod validation. severity='stable' is enforced here at the
  //    boundary (D1 — moderate/critical require an authed account).
  const parsed = medevacRequestPublicSchema.safeParse(input);
  if (!parsed.success) {
    await recordPublicActionAttempt(
      'medevac_intake',
      rl.actorFingerprint,
      'validation_failed'
    );
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // 2. ip_required guard (Phase 9 convention #12)
  const ip = await clientIp();
  if (!ip) {
    await recordPublicActionAttempt(
      'medevac_intake',
      rl.actorFingerprint,
      'validation_failed'
    );
    return { ok: false, error: 'ip_required' };
  }

  // 3. Call §4.1 RPC. Length + required + severity gate run again
  //    on the DB side as defense-in-depth.
  const client = looseClient();
  const { data, error } = await client.rpc('create_medevac_request_guest', {
    p_payload: parsed.data,
    p_ip: ip,
  });
  if (error) {
    console.error('[medevac-public.submit] rpc error', error);
    await recordPublicActionAttempt(
      'medevac_intake',
      rl.actorFingerprint,
      'rpc_error'
    );
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        medevac_request_id: string;
        medevac_request_number: string;
      }
    | { ok: false; error: string };

  if (!result.ok) {
    await recordPublicActionAttempt(
      'medevac_intake',
      rl.actorFingerprint,
      'rpc_error'
    );
    return { ok: false, error: result.error };
  }

  // 4. Revalidate the admin queue so the new request appears
  //    without manual reload.
  revalidatePath('/admin/medevac');
  await recordPublicActionAttempt(
    'medevac_intake',
    rl.actorFingerprint,
    'success'
  );

  return {
    ok: true,
    medevac_request_id: result.medevac_request_id,
    medevac_request_number: result.medevac_request_number,
  };
}
