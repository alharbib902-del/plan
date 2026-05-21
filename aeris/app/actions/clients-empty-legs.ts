'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientSession } from '@/lib/clients/auth';
import { sendClientEmptyLegReservationConfirmationEmail } from '@/lib/notifications/client-empty-leg-email';
import {
  reserveEmptyLegSchema,
  cancelMyEmptyLegReservationSchema,
  notificationPreferencesSchema,
} from '@/lib/validators/clients';

/**
 * Phase 10 PR 1 — authenticated client Server Actions for the
 * empty-legs portal.
 *
 * 3 actions total (matches spec §5 PR 1 Server Actions list):
 *   - reserveAuthenticatedEmptyLeg → wraps §4.1 RPC, sends
 *     confirmation email on success
 *   - cancelMyEmptyLegReservation → wraps §4.6 RPC (atomic
 *     full-clear + price recompute)
 *   - updateMyNotificationPreferences → writes JSONB to
 *     clients.notification_preferences with strict Zod schema
 *
 * Each action mirrors Phase 9 PR 1 / PR 3 discipline:
 *   - Honour ENABLE_CLIENT_EMPTY_LEGS_PORTAL flag (fail-closed)
 *   - Require session via requireClientSession (cookie-based)
 *   - Zod-validate input, return opaque user-facing errors
 *   - Call SECURITY DEFINER RPC via service-role client
 *   - Revalidate affected paths on success
 */

export type ClientEmptyLegsActionFailure = {
  ok: false;
  error: string;
  field_errors?: Record<string, string>;
};

// Fail-closed flag (mirrors clients-public.ts isPortalDisabled
// pattern from Phase 9 PR 1). Activation runbook flips this AFTER
// Probes 21+22+23 pass.
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

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

// Loose-typed RPC client (Phase 8 PR 2e #51 + Phase 9 PR 1
// convention #1 — preserves the Supabase JS internal `this`
// binding for parameterless + UUID-arg RPCs not registered
// in the hand-maintained database.ts Functions map).
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
// 1. reserveAuthenticatedEmptyLeg (§4.1 wrapper)
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

  // 1. Session guard
  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  // 2. Zod parse (only leg_id shape — RPC handles all state checks)
  const parsed = reserveEmptyLegSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // 3. ip_required guard (Phase 9 convention #12 + spec §4.1)
  const ip = await clientIp();
  if (!ip) return { ok: false, error: 'ip_required' };

  // 4. Call §4.1 RPC
  const client = looseClient();
  const { data, error } = await client.rpc('reserve_empty_leg_authenticated', {
    p_client_id: session.client_id,
    p_leg_id: parsed.data.leg_id,
    p_ip: ip,
  });
  if (error) {
    console.error('[clients-empty-legs.reserve] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | {
        ok: true;
        leg_id: string;
        reserved_at: string;
        expires_at: string;
        price_at_reservation: number;
      }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  // 5. Read leg_number + client display fields once for both
  //    the confirmation email + revalidatePath (Codex round 1
  //    P2 #3 fix — the public detail URL is keyed on leg_number,
  //    not the UUID, so revalidating /me/empty-legs/<UUID> was
  //    a no-op leaving the real detail page stale).
  let legNumber: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: legData } = await admin
      .from('empty_legs')
      .select(
        'leg_number, departure_airport, arrival_airport, departure_airport_freeform_snapshot, arrival_airport_freeform_snapshot'
      )
      .eq('id', parsed.data.leg_id)
      .maybeSingle();
    const { data: clientData } = await admin
      .from('clients')
      .select('full_name, auth_email')
      .eq('id', session.client_id)
      .maybeSingle();

    const leg = legData as {
      leg_number?: string;
      departure_airport?: string | null;
      arrival_airport?: string | null;
      departure_airport_freeform_snapshot?: string | null;
      arrival_airport_freeform_snapshot?: string | null;
    } | null;
    const cli = clientData as {
      full_name?: string;
      auth_email?: string;
    } | null;

    if (leg?.leg_number) legNumber = leg.leg_number;

    if (leg && cli && cli.auth_email) {
      const routeFrom =
        leg.departure_airport ||
        leg.departure_airport_freeform_snapshot ||
        '—';
      const routeTo =
        leg.arrival_airport ||
        leg.arrival_airport_freeform_snapshot ||
        '—';
      await sendClientEmptyLegReservationConfirmationEmail({
        to: cli.auth_email,
        full_name: cli.full_name ?? '',
        leg_number: leg.leg_number ?? '',
        route_from: routeFrom,
        route_to: routeTo,
        price_at_reservation: result.price_at_reservation,
        expires_at: result.expires_at,
        leg_url: `${siteUrl()}/me/empty-legs/${leg.leg_number}`,
      });
    }
  } catch (err) {
    // Non-fatal: reservation succeeded; email dispatch is
    // best-effort. The §3.6 alert singleton captures any
    // Resend failure for the canary card.
    console.error(
      '[clients-empty-legs.reserve] confirmation email dispatch failed (non-fatal)',
      err
    );
  }

  // 6. Revalidate the portal pages so the UI updates. The detail
  //    URL is /me/empty-legs/<leg_number> (NOT UUID). If the
  //    leg_number lookup above failed, fall back to the listing
  //    pages only — the detail page's data fetch will stay stale
  //    until the next manual reload, which is preferable to
  //    revalidating a wrong path.
  revalidatePath('/me/empty-legs');
  if (legNumber) {
    revalidatePath(`/me/empty-legs/${legNumber}`);
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
// 2. cancelMyEmptyLegReservation (§4.6 wrapper)
// ============================================================

export type CancelMyEmptyLegReservationResult =
  | { ok: true; leg_id: string; released_at: string }
  | ClientEmptyLegsActionFailure;

export async function cancelMyEmptyLegReservation(input: {
  leg_id: string;
}): Promise<CancelMyEmptyLegReservationResult> {
  if (isPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  // 1. Session guard
  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  // 2. Zod parse
  const parsed = cancelMyEmptyLegReservationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // 3. Call §4.6 RPC (triple guard collapsed into opaque
  //    cancel_not_allowed; full-clear + status flip + price
  //    recompute atomic)
  const client = looseClient();
  const { data, error } = await client.rpc(
    'release_empty_leg_reservation_for_client',
    {
      p_leg_id: parsed.data.leg_id,
      p_client_id: session.client_id,
    }
  );
  if (error) {
    console.error('[clients-empty-legs.cancel] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; leg_id: string; released_at: string }
    | { ok: false; error: string };

  if (!result.ok) return { ok: false, error: result.error };

  // Codex round 1 PR #62 P2 #3 fix — revalidate the leg_number-keyed
  // detail path (NOT the UUID path), because /me/empty-legs/[leg_number]
  // is the public route. Read leg_number once for the revalidate.
  let legNumber: string | null = null;
  try {
    const admin = createAdminClient();
    const { data: legData } = await admin
      .from('empty_legs')
      .select('leg_number')
      .eq('id', parsed.data.leg_id)
      .maybeSingle();
    const ln = (legData as { leg_number?: string } | null)?.leg_number;
    if (typeof ln === 'string' && ln.length > 0) legNumber = ln;
  } catch (err) {
    console.error(
      '[clients-empty-legs.cancel] leg_number lookup failed (non-fatal)',
      err
    );
  }

  revalidatePath('/me/empty-legs');
  if (legNumber) {
    revalidatePath(`/me/empty-legs/${legNumber}`);
  }
  revalidatePath('/me/empty-legs/matches');

  return {
    ok: true,
    leg_id: result.leg_id,
    released_at: result.released_at,
  };
}

// ============================================================
// 3. updateMyNotificationPreferences (§3.3 wrapper)
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
  // (in app/(client)/me/notifications/page.tsx) intentionally
  // stays available pre-activation so clients can set their
  // empty-leg preferences early — the matcher's client-loop
  // (which reads these prefs) is dead code until the flag flips,
  // so writing prefs in advance is harmless + improves UX
  // continuity at flip time. Only the base Phase 9 portal flag
  // + session guard apply here. (The §3.3 column was added in
  // PR 1's migration which is applied BEFORE PR 2 deploys per
  // the runbook §1+§2, so the UPDATE never hits a missing
  // column.)
  //
  // The two empty-leg-specific Server Actions above
  // (reserveAuthenticatedEmptyLeg + cancelMyEmptyLegReservation)
  // STILL gate behind ENABLE_CLIENT_EMPTY_LEGS_PORTAL because
  // they exercise the live RPCs + reservation flow which must
  // not run pre-flag-flip.

  // 1. Session guard
  const session = await requireClientSession();
  if (!session) return { ok: false, error: 'unauthorized' };

  // 2. Strict Zod parse — rejects unknown keys so a forged
  //    client can't pollute the column with arbitrary data
  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // 3. Direct UPDATE (no RPC — single-column write with
  //    ownership baked into the WHERE id = session.client_id).
  //    Phase 9 PR 1 #19 UUID-safe via the typed session_client_id.
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
