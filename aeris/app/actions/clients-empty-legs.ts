'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { notificationPreferencesSchema } from '@/lib/validators/clients';
import {
  runReserveEmptyLeg,
  runReleaseEmptyLeg,
} from '@/lib/empty-legs/core/empty-legs-core';

/**
 * Phase 10 PR 1 — authenticated client Server Actions for the
 * empty-legs portal.
 *
 * reserveAuthenticatedEmptyLeg + cancelMyEmptyLegReservation now
 * DELEGATE to the transport-neutral core
 * (`lib/empty-legs/core/empty-legs-core.ts`) which is shared with
 * the mobile route handlers (PR3) — single implementation, no
 * web/mobile drift. The web wrappers keep ONLY the cookie session
 * + revalidatePath; the flag check is kept first here to preserve
 * the exact prior ordering (the core re-checks it defensively).
 *
 * updateMyNotificationPreferences is unchanged (not part of the
 * empty-legs core; intentionally NOT flag-gated — see below).
 */

export type ClientEmptyLegsActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

function isPortalDisabled(): boolean {
  return process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL !== 'true';
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

// ============================================================
// 1. reserveAuthenticatedEmptyLeg (§4.1 wrapper → shared core)
// ============================================================

export type ReserveAuthenticatedEmptyLegResult =
  | {
      ok: true;
      leg_id: string;
      reserved_at: string;
      expires_at: string;
      price_at_reservation: number;
    }
  | ClientEmptyLegsActionFailure;

export async function reserveAuthenticatedEmptyLeg(input: {
  leg_id: string;
}): Promise<ReserveAuthenticatedEmptyLegResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  const ip = await clientIp();
  const result = await runReserveEmptyLeg(session.client_id, input, { ip });
  if (!result.ok) return result;

  // Detail page is keyed on leg_number (NOT the UUID).
  revalidatePath('/me/empty-legs');
  if (result.leg_number) {
    revalidatePath(`/me/empty-legs/${result.leg_number}`);
  }
  revalidatePath('/me/empty-legs/matches');

  return {
    ok: true,
    leg_id: result.leg_id,
    reserved_at: result.reserved_at,
    expires_at: result.expires_at,
    price_at_reservation: result.price_at_reservation,
  };
}

// ============================================================
// 2. cancelMyEmptyLegReservation (§4.6 wrapper → shared core)
// ============================================================

export type CancelMyEmptyLegReservationResult =
  | { ok: true; leg_id: string; released_at: string }
  | ClientEmptyLegsActionFailure;

export async function cancelMyEmptyLegReservation(input: {
  leg_id: string;
}): Promise<CancelMyEmptyLegReservationResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const session = await requireClientSession();
  const result = await runReleaseEmptyLeg(session.client_id, input);
  if (!result.ok) return result;

  revalidatePath('/me/empty-legs');
  if (result.leg_number) {
    revalidatePath(`/me/empty-legs/${result.leg_number}`);
  }
  revalidatePath('/me/empty-legs/matches');

  return {
    ok: true,
    leg_id: result.leg_id,
    released_at: result.released_at,
  };
}

// ============================================================
// 3. updateMyNotificationPreferences (§3.3 wrapper) — unchanged
// ============================================================

export type UpdateMyNotificationPreferencesResult =
  | { ok: true }
  | ClientEmptyLegsActionFailure;

export async function updateMyNotificationPreferences(input: {
  empty_legs: { email: boolean; wa_link: boolean };
  marketing: boolean;
}): Promise<UpdateMyNotificationPreferencesResult> {
  // Codex round 1 PR #63 P2 #2 fix — do NOT gate behind
  // ENABLE_CLIENT_EMPTY_LEGS_PORTAL. The /me/notifications page
  // intentionally stays available pre-activation so clients can
  // set their empty-leg preferences early.

  const session = await requireClientSession();

  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('clients')
      .update({
        notification_preferences: parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.client_id);
    if (error) {
      console.error('[clients-empty-legs.updatePrefs] update error', error);
      return { ok: false, error: 'server_error' };
    }
  } catch (err) {
    console.error('[clients-empty-legs.updatePrefs] threw', err);
    return { ok: false, error: 'server_error' };
  }

  revalidatePath('/me/notifications');
  return { ok: true };
}
