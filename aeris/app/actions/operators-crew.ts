'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOperatorSession } from '@/lib/operators/auth';
import {
  createCrewSchema,
  updateCrewSchema,
  setCrewAvailabilitySchema,
} from '@/lib/operators/validators/crew';
import { fieldErrorsFromZod } from '@/lib/validators/field-errors';

/**
 * Phase 14 — operator crew Server Actions (crew_members CRUD).
 *
 * Mirrors operators-fleet.ts: requireOperatorSession + password_must_change
 * guard + Zod + SECURITY DEFINER RPC with p_operator_id from the session
 * (never client) + revalidate. There is NO delete.
 */

export type CrewActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};
export type CrewActionResult = { ok: true } | CrewActionFailure;

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

export async function createCrew(input: unknown): Promise<CrewActionResult> {
  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = createCrewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const { data, error } = await looseClient().rpc('create_operator_crew', {
    p_operator_id: session.operator_id,
    p_payload: parsed.data,
  });
  if (error) {
    console.error('[operators-crew.createCrew] rpc error', error);
    return { ok: false, error: 'server_error' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'server_error' };

  revalidatePath('/operator/crew');
  return { ok: true };
}

export async function updateCrew(input: unknown): Promise<CrewActionResult> {
  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = updateCrewSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const { data, error } = await looseClient().rpc('update_operator_crew', {
    p_operator_id: session.operator_id,
    p_crew_id: parsed.data.crew_id,
    p_payload: parsed.data,
  });
  if (error) {
    console.error('[operators-crew.updateCrew] rpc error', error);
    return { ok: false, error: 'server_error' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'server_error' };

  revalidatePath('/operator/crew');
  return { ok: true };
}

export async function setCrewAvailability(
  input: unknown
): Promise<CrewActionResult> {
  const session = await requireOperatorSession();
  if (session.password_must_change) {
    return { ok: false, error: 'must_change_password_first' };
  }

  const parsed = setCrewAvailabilitySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_failed' };
  }

  const { data, error } = await looseClient().rpc(
    'set_operator_crew_availability',
    {
      p_operator_id: session.operator_id,
      p_crew_id: parsed.data.crew_id,
      p_is_available: parsed.data.is_available,
    }
  );
  if (error) {
    console.error('[operators-crew.setCrewAvailability] rpc error', error);
    return { ok: false, error: 'server_error' };
  }
  const result = data as { ok: boolean; error?: string };
  if (!result.ok) return { ok: false, error: result.error ?? 'server_error' };

  revalidatePath('/operator/crew');
  return { ok: true };
}
