'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminSession } from '@/lib/admin/auth';
import { ADMIN_WRITE_ROLES } from '@/lib/admin/rbac';
import {
  acceptOfferSchema,
  declineOfferSchema,
  cancelRequestSchema,
} from '@/lib/cargo/validators/cargo-actions';
import type { CargoAircraftCapabilityInsert } from '@/lib/cargo/types';

/**
 * Phase 11 PR 1 + PR 2 + PR 3 — admin Server Actions for the
 * cargo surface.
 *
 * 5 actions total:
 *   - upsertCargoAircraftCapability (PR 1)
 *   - adminAcceptCargoOfferOnBehalf (PR 2)
 *   - adminDeclineCargoOfferOnBehalf (PR 2)
 *   - adminCancelCargoRequestOnBehalf (PR 2)
 *   - adminManualDispatchCargoRequest (PR 3 §6.2)
 *
 * Auth (Codex round 1 PR #65 P1 #1 fix): every action calls
 * `requireAdminSession()` BEFORE any validation or write.
 * Relying on the admin layout's auth check is NOT enough for
 * Server Actions — the action endpoint is reachable directly
 * via POST regardless of which page imported it. Mirrors
 * `app/actions/empty-legs.ts:123` discipline.
 *
 * Admin path on cargo RPCs (per Phase 11 spec §4.4 round 6
 * P1 #1): pass BOTH p_actor_client_id AND p_actor_admin_user_id
 * as NULL after requireAdminSession() at the Server Action
 * layer. The RPCs accept this as the admin path; they reject
 * `actor_ambiguous` only if both are non-NULL. Aeris admins
 * have NO users row (Phase 8 cookie + ENV auth), so there's no
 * UUID to pass as p_actor_admin_user_id.
 *
 * The DB writes go through service-role; the cargo tables have
 * RLS enabled (round 6 P1 #3) but service-role bypasses.
 */

export type CargoAdminActionFailure = {
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
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });

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

// ============================================================
// PR 2 — adminAcceptCargoOfferOnBehalf
// ============================================================
//
// Admin path on §4.4 accept_cargo_offer for guest cargo requests.
// Pass both actor IDs as NULL (per round 6 P1 #1). The RPC will
// reject with `admin_cannot_accept_for_authed_client` if the
// request has client_id IS NOT NULL — defense-in-depth so the
// admin button only ever works on guest paths even if the UI
// renders it incorrectly.

export type AdminAcceptCargoOfferResult =
  | {
      ok: true;
      booking_id: string;
      offer_id: string;
      cargo_request_id: string;
      accepted_at: string;
    }
  | CargoAdminActionFailure;

export async function adminAcceptCargoOfferOnBehalf(input: {
  offer_id: string;
}): Promise<AdminAcceptCargoOfferResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = acceptOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('accept_cargo_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: null,
    p_actor_admin_user_id: null,
  });
  if (error) {
    console.error('[cargo-admin.acceptOnBehalf] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        booking_id: string;
        offer_id: string;
        cargo_request_id: string;
        accepted_at: string;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/admin/cargo');
  revalidatePath(`/admin/cargo/${result.cargo_request_id}`);
  revalidatePath('/admin/leads');

  return {
    ok: true,
    booking_id: result.booking_id,
    offer_id: result.offer_id,
    cargo_request_id: result.cargo_request_id,
    accepted_at: result.accepted_at,
  };
}

// ============================================================
// PR 2 — adminDeclineCargoOfferOnBehalf
// ============================================================

export type AdminDeclineCargoOfferResult =
  | { ok: true; offer_id: string; already_declined?: boolean }
  | CargoAdminActionFailure;

export async function adminDeclineCargoOfferOnBehalf(input: {
  offer_id: string;
  reason?: string;
}): Promise<AdminDeclineCargoOfferResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = declineOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('decline_cargo_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: null,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[cargo-admin.declineOnBehalf] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; offer_id: string; already_declined?: boolean }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/admin/cargo');

  return {
    ok: true,
    offer_id: result.offer_id,
    already_declined: result.already_declined,
  };
}

// ============================================================
// PR 2 — adminCancelCargoRequestOnBehalf
// ============================================================

export type AdminCancelCargoRequestResult =
  | {
      ok: true;
      request_id: string;
      cascade_declined_offers: number;
      already_cancelled?: boolean;
    }
  | CargoAdminActionFailure;

export async function adminCancelCargoRequestOnBehalf(input: {
  request_id: string;
  reason?: string;
}): Promise<AdminCancelCargoRequestResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('cancel_cargo_request', {
    p_request_id: parsed.data.request_id,
    p_actor_client_id: null,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[cargo-admin.cancelOnBehalf] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        request_id: string;
        cascade_declined_offers: number;
        already_cancelled?: boolean;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/admin/cargo');
  revalidatePath(`/admin/cargo/${parsed.data.request_id}`);

  return {
    ok: true,
    request_id: result.request_id,
    cascade_declined_offers: result.cascade_declined_offers ?? 0,
    already_cancelled: result.already_cancelled,
  };
}

// ============================================================
// PR 3 §6.2 — adminManualDispatchCargoRequest
// ============================================================
//
// Inserts an outbox row via publish_cargo_dispatch_event RPC
// with event_type='manual_redispatch'. The next 15-min cron
// drain picks it up and re-runs distribution + notifications.
//
// v1 of this action just inserts the outbox row — no immediate
// trigger of the cron. Future polish can POST to the internal
// route with the shared CRON_SECRET for instant dispatch. The
// admin sees a confirmation banner; the actual notifications
// land within 15 minutes.
//
// Available on BOTH guest and authed cargo requests (admin
// override is legitimate either way per spec §6.2).

export interface AdminManualDispatchInput {
  request_id: string;
}

export type AdminManualDispatchResult =
  | { ok: true; request_id: string }
  | CargoAdminActionFailure;

export async function adminManualDispatchCargoRequest(
  input: AdminManualDispatchInput
): Promise<AdminManualDispatchResult> {
  await requireAdminSession({ roles: ADMIN_WRITE_ROLES });
  if (isCargoDisabled()) return { ok: false, error: 'flag_disabled' };

  // Reuse the existing UUID guard from cancelRequestSchema —
  // same shape, same validation.
  const parsed = cancelRequestSchema.safeParse({
    request_id: input.request_id,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc('publish_cargo_dispatch_event', {
    p_cargo_request_id: parsed.data.request_id,
    p_event_type: 'manual_redispatch',
  });
  if (error) {
    console.error('[cargo-admin.manualDispatch] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; cargo_request_id: string }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/admin/cargo/${parsed.data.request_id}`);

  return { ok: true, request_id: parsed.data.request_id };
}
