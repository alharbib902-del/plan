'use server';

import { revalidatePath } from 'next/cache';

import { requireAdminSession } from '@/lib/admin/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/utils/uuid';
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

export interface UpsertMedicalCertificationInput {
  aircraft_id: string;
  supports_BMT: boolean;
  supports_ALS: boolean;
  supports_CCT: boolean;
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
    input.supports_BMT ||
    input.supports_ALS ||
    input.supports_CCT ||
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
    supports_BMT: input.supports_BMT,
    supports_ALS: input.supports_ALS,
    supports_CCT: input.supports_CCT,
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
