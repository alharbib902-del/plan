'use server';

import { revalidatePath } from 'next/cache';

import { requireAdminSession } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
import {
  acceptOfferSchema,
  declineOfferSchema,
  cancelRequestSchema,
} from '@/lib/medevac/validators/medevac-actions';
import { activateSubscriptionSchema } from '@/lib/medevac/validators/medevac-subscription';
import type {
  AircraftMedicalCertificationRow,
  MedicalCertifyingAuthority,
} from '@/lib/medevac/types';

/**
 * Phase 12 PR 1 — admin Server Actions for the medevac surface.
 *
 * 1 action in PR 1 scope:
 *   - upsertMedicalCertification — mirror of Phase 11's
 *     upsertCargoAircraftCapability. Lets admin maintain the
 *     per-aircraft medical capability + cert expiry matrix.
 *     The DB trigger enforce_aircraft_medical_certifications_trigger
 *     applies the three structural rules (future-only expiry on
 *     INSERT; no flag re-enable on expired cert; at-least-one
 *     flag true except for the PR 3 cron expiry-flip path).
 *
 * PR 2 will add admin-on-behalf accept/decline/cancel + Shield
 * activation; PR 3 will add manual dispatch.
 *
 * Auth (Phase 11 round 1 PR #65 P1 #1 fix discipline): every
 * action calls requireAdminSession() BEFORE any validation or
 * write. Relying on the admin layout's auth check is NOT enough
 * for Server Actions — the action endpoint is reachable directly
 * via POST regardless of which page imported it.
 */

export type MedevacAdminActionFailure = {
  ok: false;
  error: string;
};

function isMedevacDisabled(): boolean {
  return process.env.ENABLE_MEDEVAC !== 'true';
}

const SUPPORTED_AUTHORITIES: readonly MedicalCertifyingAuthority[] = [
  'SCFHS',
  'civil_aviation_authority',
  'foreign_equivalent',
  'other',
];

// ============================================================
// upsertMedicalCertification
// ============================================================

/**
 * Round 3 PR #76 P1 #1 fix — lowercase supports_* fields to
 * match the actual Postgres column names. Postgres folds
 * unquoted `supports_BMT` etc. to `supports_bmt` at DDL time,
 * so the upsert JSON payload MUST use lowercase. The
 * previous PascalCase keys were silently dropped by
 * PostgREST and the cert matrix couldn't seed any rows.
 */
export interface UpsertMedicalCertificationInput {
  aircraft_id: string;
  supports_bmt: boolean;
  supports_als: boolean;
  supports_cct: boolean;
  supports_repatriation: boolean;
  certifying_authority: MedicalCertifyingAuthority;
  certification_number?: string | null;
  /**
   * ISO timestamp. The DB trigger rejects past values on
   * INSERT (SQLSTATE 22023) and rejects re-enable on
   * already-expired UPDATE; the action also surfaces a
   * structured `expires_in_past` error before round-tripping.
   */
  certification_expires_at: string;
  notes?: string | null;
}

export type UpsertMedicalCertificationResult =
  | { ok: true; aircraft_id: string }
  | MedevacAdminActionFailure;

export async function upsertMedicalCertification(
  input: UpsertMedicalCertificationInput
): Promise<UpsertMedicalCertificationResult> {
  // 1. Admin auth gate (Phase 11 round 1 PR #65 P1 #1 discipline)
  requireAdminSession();

  // 2. Flag gate (fail-closed)
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  // 3. Input shape guards (defense before round-trip)
  if (!input.aircraft_id || !isUuid(input.aircraft_id)) {
    return { ok: false, error: 'aircraft_id_required' };
  }

  const anyTrue =
    input.supports_bmt ||
    input.supports_als ||
    input.supports_cct ||
    input.supports_repatriation;
  if (!anyTrue) {
    return { ok: false, error: 'at_least_one_supports_required' };
  }

  if (!SUPPORTED_AUTHORITIES.includes(input.certifying_authority)) {
    return { ok: false, error: 'certifying_authority_invalid' };
  }

  if (
    typeof input.certification_expires_at !== 'string' ||
    input.certification_expires_at.length === 0
  ) {
    return { ok: false, error: 'certification_expires_at_required' };
  }
  const expiresAt = new Date(input.certification_expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    return { ok: false, error: 'certification_expires_at_invalid' };
  }
  if (expiresAt.getTime() <= Date.now()) {
    // Defensive: the DB trigger rejects this on INSERT anyway,
    // but the Server Action returns a clean structured error
    // before the round-trip so the UI can render it directly.
    return { ok: false, error: 'expires_in_past' };
  }

  // 4. Build the upsert payload
  const admin = createAdminClient();
  const payload: Partial<AircraftMedicalCertificationRow> = {
    aircraft_id: input.aircraft_id,
    supports_bmt: input.supports_bmt,
    supports_als: input.supports_als,
    supports_cct: input.supports_cct,
    supports_repatriation: input.supports_repatriation,
    certifying_authority: input.certifying_authority,
    certification_number: input.certification_number ?? null,
    certification_expires_at: expiresAt.toISOString(),
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  // Loose-cast pattern (Phase 9 convention #15) — table not in
  // types/database.ts yet.
  type LooseUpsertClient = {
    from: (table: string) => {
      upsert: (
        payload: Partial<AircraftMedicalCertificationRow>,
        opts: { onConflict: string }
      ) => Promise<{
        data: unknown;
        error: { code?: string; message?: string } | null;
      }>;
    };
  };
  const looseClient = admin as unknown as LooseUpsertClient;
  const { error } = await looseClient
    .from('aircraft_medical_certifications')
    .upsert(payload, { onConflict: 'aircraft_id' });

  if (error) {
    console.error('[medevac-admin.upsertCert] db error', error);
    // The DB trigger uses two SQLSTATEs (22023 for past expiry /
    // re-enable, 23514 for at-least-one violation). Map them to
    // structured errors for cleaner UI handling.
    if (error.code === '22023') {
      return { ok: false, error: 'expires_in_past_or_reenable_blocked' };
    }
    if (error.code === '23514') {
      return { ok: false, error: 'at_least_one_supports_required' };
    }
    return { ok: false, error: 'server_error' };
  }

  revalidatePath('/admin/medevac/medical-certifications');
  return { ok: true, aircraft_id: input.aircraft_id };
}

// ============================================================
// Phase 12 PR 2 additions — admin lifecycle + Shield activation
// + shield-config upsert.
//
// adminAcceptMedevacOfferOnBehalf / Decline / Cancel: mirror the
// Phase 11 cargo on-behalf pattern (admin path only legal on
// guest requests — the RPC enforces `admin_cannot_*_authed`).
//
// adminActivateSubscription: flips pending_payment → active and
// stamps start/end dates atomically via §4.9 RPC.
//
// adminUpsertShieldConfig: sets the singleton
// aeris_shield_config.default_operator_id used by §4.7
// consume_aeris_shield_event.
// ============================================================

// Helper — loose-typed RPC client shared by the on-behalf actions.
type LooseRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
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

// ------------------------------------------------------------
// adminAcceptMedevacOfferOnBehalf → §4.4 (admin path)
// ------------------------------------------------------------

export type AdminAcceptMedevacOfferResult =
  | {
      ok: true;
      booking_id: string;
      offer_id: string;
      medevac_request_id: string;
      accepted_at: string;
    }
  | MedevacAdminActionFailure
  | (MedevacAdminActionFailure & { field_errors: Record<string, string> });

export async function adminAcceptMedevacOfferOnBehalf(input: {
  offer_id: string;
}): Promise<AdminAcceptMedevacOfferResult> {
  requireAdminSession();
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = acceptOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    } as AdminAcceptMedevacOfferResult;
  }

  const rpc = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await rpc.rpc('accept_medevac_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: null,
    p_actor_admin_user_id: null,
  });
  if (error) {
    console.error('[medevac-admin.acceptOnBehalf] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        booking_id: string;
        offer_id: string;
        medevac_request_id: string;
        accepted_at: string;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/admin/medevac');
  revalidatePath(`/admin/medevac/${result.medevac_request_id}`);

  return {
    ok: true,
    booking_id: result.booking_id,
    offer_id: result.offer_id,
    medevac_request_id: result.medevac_request_id,
    accepted_at: result.accepted_at,
  };
}

// ------------------------------------------------------------
// adminDeclineMedevacOfferOnBehalf → §4.5 decline (admin path)
// ------------------------------------------------------------

export type AdminDeclineMedevacOfferResult =
  | { ok: true; offer_id: string; already_declined?: boolean }
  | MedevacAdminActionFailure
  | (MedevacAdminActionFailure & { field_errors: Record<string, string> });

export async function adminDeclineMedevacOfferOnBehalf(input: {
  offer_id: string;
  reason?: string;
}): Promise<AdminDeclineMedevacOfferResult> {
  requireAdminSession();
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = declineOfferSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    } as AdminDeclineMedevacOfferResult;
  }

  const rpc = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await rpc.rpc('decline_medevac_offer', {
    p_offer_id: parsed.data.offer_id,
    p_actor_client_id: null,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[medevac-admin.declineOnBehalf] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; offer_id: string; already_declined?: boolean }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/admin/medevac');

  return {
    ok: true,
    offer_id: result.offer_id,
    already_declined: result.already_declined,
  };
}

// ------------------------------------------------------------
// adminCancelMedevacRequestOnBehalf → §4.6 cancel (admin path)
// ------------------------------------------------------------

export type AdminCancelMedevacRequestResult =
  | {
      ok: true;
      request_id: string;
      cascade_declined_offers: number;
      already_cancelled?: boolean;
    }
  | MedevacAdminActionFailure
  | (MedevacAdminActionFailure & { field_errors: Record<string, string> });

export async function adminCancelMedevacRequestOnBehalf(input: {
  request_id: string;
  reason?: string;
}): Promise<AdminCancelMedevacRequestResult> {
  requireAdminSession();
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = cancelRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    } as AdminCancelMedevacRequestResult;
  }

  const rpc = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await rpc.rpc('cancel_medevac_request', {
    p_request_id: parsed.data.request_id,
    p_actor_client_id: null,
    p_actor_admin_user_id: null,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) {
    console.error('[medevac-admin.cancelOnBehalf] rpc error', error);
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

  revalidatePath('/admin/medevac');
  revalidatePath(`/admin/medevac/${parsed.data.request_id}`);

  return {
    ok: true,
    request_id: result.request_id,
    cascade_declined_offers: result.cascade_declined_offers ?? 0,
    already_cancelled: result.already_cancelled,
  };
}

// ------------------------------------------------------------
// adminActivateSubscription → §4.9 admin_activate_subscription
// ------------------------------------------------------------

export type AdminActivateSubscriptionResult =
  | {
      ok: true;
      subscription_id: string;
      subscription_number?: string;
      start_date?: string;
      end_date?: string;
      next_renewal_due?: string;
      already_active?: boolean;
    }
  | MedevacAdminActionFailure
  | (MedevacAdminActionFailure & { field_errors: Record<string, string> });

export async function adminActivateSubscription(input: {
  subscription_id: string;
}): Promise<AdminActivateSubscriptionResult> {
  requireAdminSession();
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = activateSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    } as AdminActivateSubscriptionResult;
  }

  const rpc = createAdminClient() as unknown as LooseRpcClient;
  const { data, error } = await rpc.rpc('admin_activate_subscription', {
    p_subscription_id: parsed.data.subscription_id,
  });
  if (error) {
    console.error('[medevac-admin.activateSub] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        subscription_id: string;
        subscription_number?: string;
        start_date?: string;
        end_date?: string;
        next_renewal_due?: string;
        already_active?: boolean;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/admin/medevac/subscriptions');
  revalidatePath(
    `/admin/medevac/subscriptions/${parsed.data.subscription_id}`
  );

  return {
    ok: true,
    subscription_id: result.subscription_id,
    subscription_number: result.subscription_number,
    start_date: result.start_date,
    end_date: result.end_date,
    next_renewal_due: result.next_renewal_due,
    already_active: result.already_active,
  };
}

// ------------------------------------------------------------
// adminUpsertShieldConfig — singleton update of
// aeris_shield_config.default_operator_id + notification email.
//
// Direct table update (no RPC); the singleton has RLS enabled
// so service-role bypass + admin auth gate is the only path.
// ------------------------------------------------------------

export interface UpsertShieldConfigInput {
  default_operator_id: string | null;
  founder_notification_email?: string | null;
}

export type AdminUpsertShieldConfigResult =
  | { ok: true }
  | MedevacAdminActionFailure;

export async function adminUpsertShieldConfig(
  input: UpsertShieldConfigInput
): Promise<AdminUpsertShieldConfigResult> {
  requireAdminSession();
  if (isMedevacDisabled()) return { ok: false, error: 'flag_disabled' };

  if (
    input.default_operator_id !== null &&
    !isUuid(input.default_operator_id)
  ) {
    return { ok: false, error: 'default_operator_id_invalid' };
  }
  if (
    input.founder_notification_email &&
    input.founder_notification_email.length > 120
  ) {
    return { ok: false, error: 'founder_email_invalid' };
  }

  type LooseUpdateClient = {
    from: (table: string) => {
      update: (payload: Record<string, unknown>) => {
        eq: (
          col: string,
          val: number
        ) => Promise<{
          data: unknown;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
  };
  const loose = createAdminClient() as unknown as LooseUpdateClient;
  const payload: Record<string, unknown> = {
    default_operator_id: input.default_operator_id,
    updated_at: new Date().toISOString(),
  };
  if (input.founder_notification_email !== undefined) {
    payload['founder_notification_email'] =
      input.founder_notification_email;
  }
  const { error } = await loose
    .from('aeris_shield_config')
    .update(payload)
    .eq('id', 1);
  if (error) {
    console.error('[medevac-admin.shieldConfig] update error', error);
    if (error.code === '23503') {
      // Foreign key violation — operator_id doesn't exist.
      return { ok: false, error: 'default_operator_not_found' };
    }
    return { ok: false, error: 'server_error' };
  }

  revalidatePath('/admin/medevac/shield-config');
  return { ok: true };
}
