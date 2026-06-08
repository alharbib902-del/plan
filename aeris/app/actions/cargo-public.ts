'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { cargoRequestPublicSchema } from '@/lib/cargo/validators/cargo-request';
import {
  checkPublicActionRateLimit,
  recordPublicActionAttempt,
} from '@/lib/rate-limit/public-action';
import { fieldErrorsFromZod } from '@/lib/validators/field-errors';

/**
 * Phase 11 PR 1 — public cargo intake Server Action.
 *
 * Wraps §4.1 create_cargo_request_guest RPC. The /cargo public
 * form (anonymous browser, no session) submits its full payload
 * here; the action validates via Zod, fetches the IP for the
 * RPC's defense-in-depth ip_required guard, and dispatches to
 * the SECURITY DEFINER function.
 *
 * Gated behind ENABLE_CARGO env flag (fail-closed mirroring
 * Phase 9 ENABLE_CLIENT_PORTAL + Phase 10 ENABLE_CLIENT_EMPTY_LEGS_PORTAL
 * patterns). When unset or false, the public /cargo route 404s
 * AND this action returns flag_disabled — defense-in-depth so
 * a leaked deployment with the flag off can't accept submissions
 * via direct RPC invocation.
 *
 * PR 2 will add cargo-clients.ts with submitCargoRequestAuthed
 * wrapping §4.2 create_cargo_request_authenticated.
 */

export type CargoPublicActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isCargoDisabled(): boolean {
  return process.env.ENABLE_CARGO !== 'true';
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

// Loose-typed RPC client (Phase 9 PR 1 convention #1 + Phase 8
// PR 2e #48 — RPC not registered in Functions map; preserves
// Supabase JS internal `this` binding).
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
// submitCargoRequestPublic — wraps §4.1 RPC
// ============================================================

export type SubmitCargoRequestPublicResult =
  | {
      ok: true;
      cargo_request_id: string;
      cargo_request_number: string;
      created_at: string;
    }
  | CargoPublicActionFailure;

export async function submitCargoRequestPublic(
  input: unknown
): Promise<SubmitCargoRequestPublicResult> {
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  // 0. Rate-limit gate (per-IP, 3 failures/15min, 15 attempts/hr).
  // Fail-closed on storage/secret errors so an availability gap
  // can't open the throttle.
  const rl = await checkPublicActionRateLimit('cargo_intake');
  if (!rl.ok) {
    if (rl.reason !== 'storage_error' && rl.reason !== 'secret_missing') {
      await recordPublicActionAttempt(
        'cargo_intake',
        rl.actorFingerprint,
        'rate_limited'
      );
    }
    return { ok: false, error: 'rate_limited' };
  }

  // 1. Zod validation (per-category required fields, route presence,
  //    date order, length bounds — primary validation line).
  const parsed = cargoRequestPublicSchema.safeParse(input);
  if (!parsed.success) {
    await recordPublicActionAttempt(
      'cargo_intake',
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
      'cargo_intake',
      rl.actorFingerprint,
      'validation_failed'
    );
    return { ok: false, error: 'ip_required' };
  }

  // 3. Call §4.1 RPC. The full Zod-validated object becomes the
  //    JSONB payload. The RPC re-validates length + required +
  //    cargo_type as defense-in-depth + handles per-category
  //    DB CHECK enforcement.
  const client = looseClient();
  const { data, error } = await client.rpc('create_cargo_request_guest', {
    p_payload: parsed.data,
    p_ip: ip,
  });
  if (error) {
    console.error('[cargo-public.submit] rpc error', error);
    await recordPublicActionAttempt(
      'cargo_intake',
      rl.actorFingerprint,
      'rpc_error'
    );
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        cargo_request_id: string;
        cargo_request_number: string;
        created_at: string;
      }
    | { ok: false; error: string };

  if (!result.ok) {
    await recordPublicActionAttempt(
      'cargo_intake',
      rl.actorFingerprint,
      'rpc_error'
    );
    return { ok: false, error: result.error };
  }

  // 4. Revalidate the admin queue so the new request appears
  //    without manual reload.
  revalidatePath('/admin/cargo');
  await recordPublicActionAttempt(
    'cargo_intake',
    rl.actorFingerprint,
    'success'
  );

  return {
    ok: true,
    cargo_request_id: result.cargo_request_id,
    cargo_request_number: result.cargo_request_number,
    created_at: result.created_at,
  };
}
