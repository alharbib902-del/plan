'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOperatorSession } from '@/lib/operators/auth';
import {
  createAircraftSchema,
  updateAircraftSchema,
  retireAircraftSchema,
} from '@/lib/operators/validators/fleet';
import { fieldErrorsFromZod } from '@/lib/validators/field-errors';

/**
 * Phase 14 — operator fleet Server Actions (aircraft CRUD).
 *
 * Discipline (mirrors cargo-operators.ts):
 *   1. requireOperatorSession() every call (mid-session suspend/reset
 *      propagates immediately).
 *   2. password_must_change guard (reject before any write).
 *   3. Zod-validate input (defence-in-depth; the RPC re-validates).
 *   4. Call the SECURITY DEFINER RPC with p_operator_id = session id
 *      (never client input); the RPC enforces ownership + uniqueness.
 *   5. Revalidate /operator/fleet on success.
 */

export type FleetActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};
export type FleetActionResult = { ok: true } | FleetActionFailure;

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

export async function createAircraft(
  input: unknown
): Promise<FleetActionResult> {
  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = createAircraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const { data, error } = await looseClient().rpc('create_operator_aircraft', {
    p_operator_id: session.operator_id,
    p_payload: parsed.data,
  });
  if (error) {
    console.error('[operators-fleet.createAircraft] rpc error', error);
    return { ok: false, error: 'server_error' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'server_error' };

  revalidatePath('/operator/fleet');
  return { ok: true };
}

export async function updateAircraft(
  input: unknown
): Promise<FleetActionResult> {
  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = updateAircraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const { data, error } = await looseClient().rpc('update_operator_aircraft', {
    p_operator_id: session.operator_id,
    p_aircraft_id: parsed.data.aircraft_id,
    p_payload: parsed.data,
  });
  if (error) {
    console.error('[operators-fleet.updateAircraft] rpc error', error);
    return { ok: false, error: 'server_error' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'server_error' };

  revalidatePath('/operator/fleet');
  return { ok: true };
}

export async function retireAircraft(
  input: unknown
): Promise<FleetActionResult> {
  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = retireAircraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_failed' };
  }

  const { data, error } = await looseClient().rpc('retire_operator_aircraft', {
    p_operator_id: session.operator_id,
    p_aircraft_id: parsed.data.aircraft_id,
  });
  if (error) {
    console.error('[operators-fleet.retireAircraft] rpc error', error);
    return { ok: false, error: 'server_error' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'server_error' };

  revalidatePath('/operator/fleet');
  return { ok: true };
}
