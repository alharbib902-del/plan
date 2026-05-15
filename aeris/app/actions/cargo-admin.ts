'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminSession } from '@/lib/admin/auth';
import type { CargoAircraftCapabilityInsert } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 — admin Server Actions for the cargo surface.
 *
 * Currently 1 action (capability matrix upsert). PR 2 will
 * add accept/decline-on-behalf for guest cargo requests.
 *
 * Auth (Codex round 1 PR #65 P1 #1 fix): every action calls
 * `requireAdminSession()` BEFORE any validation or write.
 * Relying on the admin layout's auth check is NOT enough for
 * Server Actions — the action endpoint is reachable directly
 * via POST regardless of which page imported it. Mirrors
 * `app/actions/empty-legs.ts:123` discipline.
 *
 * The DB write goes through service-role; the
 * cargo_aircraft_capabilities table has RLS enabled (round 6
 * P1 #3) but service-role bypasses.
 */

export type CargoAdminActionFailure = {
  ok: false;
  error: string;
};

function isCargoDisabled(): boolean {
  return process.env.ENABLE_CARGO !== 'true';
}

// ============================================================
// upsertCargoAircraftCapability
// ============================================================

export interface UpsertCargoCapabilityInput {
  aircraft_id: string;
  supports_horse: boolean;
  supports_luxury_car: boolean;
  supports_valuables: boolean;
  supports_other: boolean;
  max_horse_count?: number | null;
  max_car_count?: number | null;
  max_payload_kg?: number | null;
  notes?: string | null;
}

export type UpsertCargoCapabilityResult =
  | { ok: true; aircraft_id: string }
  | CargoAdminActionFailure;

export async function upsertCargoAircraftCapability(
  input: UpsertCargoCapabilityInput
): Promise<UpsertCargoCapabilityResult> {
  // Codex round 1 PR #65 P1 #1 fix — admin auth gate at the
  // Server Action boundary. requireAdminSession() throws
  // NEXT_REDIRECT to /admin/login if the cookie is missing/
  // invalid (Phase 8 ADMIN_INBOX_PASSWORD), aborting the
  // caller before any flag check or DB write.
  requireAdminSession();

  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  if (!input.aircraft_id || input.aircraft_id.length === 0) {
    return { ok: false, error: 'aircraft_id_required' };
  }

  // Defense-in-depth: at least one supports_* must be true
  // (DB CHECK enforces this too via
  // cargo_aircraft_capabilities_at_least_one_check, but the
  // Server Action returns a clean error before the round-trip).
  const anyTrue =
    input.supports_horse ||
    input.supports_luxury_car ||
    input.supports_valuables ||
    input.supports_other;
  if (!anyTrue) {
    return { ok: false, error: 'at_least_one_required' };
  }

  const admin = createAdminClient();
  const payload: CargoAircraftCapabilityInsert = {
    aircraft_id: input.aircraft_id,
    supports_horse: input.supports_horse,
    supports_luxury_car: input.supports_luxury_car,
    supports_valuables: input.supports_valuables,
    supports_other: input.supports_other,
    max_horse_count: input.max_horse_count ?? null,
    max_car_count: input.max_car_count ?? null,
    max_payload_kg: input.max_payload_kg ?? null,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from('cargo_aircraft_capabilities')
    .upsert(payload, { onConflict: 'aircraft_id' });

  if (error) {
    console.error('[cargo-admin.upsertCapability] db error', error);
    return { ok: false, error: 'server_error' };
  }

  revalidatePath('/admin/cargo/aircraft-capabilities');
  return { ok: true, aircraft_id: input.aircraft_id };
}
