import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendClientEmptyLegReservationConfirmationEmail } from '@/lib/notifications/client-empty-leg-email';
import {
  reserveEmptyLegSchema,
  cancelMyEmptyLegReservationSchema,
} from '@/lib/validators/clients';
import {
  createAlertSchema,
  alertIdSchema,
} from '@/lib/empty-legs/alert-validators';
import {
  listClientAlerts,
  type ClientEmptyLegAlertRow,
} from '@/lib/empty-legs/alerts';

/**
 * Transport-neutral empty-legs core.
 *
 * Reserve/release business logic (incl. the best-effort
 * confirmation email + leg_number lookup for revalidate) lives
 * here ONCE so the web Server Actions
 * (`app/actions/clients-empty-legs.ts`, cookie) and the mobile
 * route handlers (`app/api/v1/mobile/empty-legs/*`, Bearer)
 * share a single implementation — same parity guarantee as the
 * charter core (PR2). The caller supplies `clientId` (from its
 * validated session) and the request IP; nothing here touches
 * `cookies()`/`redirect()`.
 *
 * Alert mutations reuse the SAME shared validators
 * (`alert-validators.ts`) + the SAME SECURITY DEFINER RPCs the
 * web alert actions call; ownership is enforced in the RPC via
 * `p_client_id` (passed from the session, never the body).
 */

export type EmptyLegCoreFailure = {
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

function isEmptyLegsPortalDisabled(): boolean {
  return process.env.ENABLE_CLIENT_EMPTY_LEGS_PORTAL !== 'true';
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://aeris.sa';
}

// ============================================================
// Reserve (§4.1)
// ============================================================

export type RunReserveEmptyLegResult =
  | {
      ok: true;
      leg_id: string;
      reserved_at: string;
      expires_at: string;
      price_at_reservation: number;
      /** For the web wrapper's revalidatePath (detail is keyed on leg_number). */
      leg_number: string | null;
    }
  | EmptyLegCoreFailure;

export async function runReserveEmptyLeg(
  clientId: string,
  input: { leg_id: string },
  ctx: { ip: string | null }
): Promise<RunReserveEmptyLegResult> {
  if (isEmptyLegsPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = reserveEmptyLegSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  // §4.1 requires the caller IP for the reservation audit row.
  if (!ctx.ip) return { ok: false, error: 'ip_required' };

  const client = looseClient();
  const { data, error } = await client.rpc('reserve_empty_leg_authenticated', {
    p_client_id: clientId,
    p_leg_id: parsed.data.leg_id,
    p_ip: ctx.ip,
  });
  if (error) {
    console.error('[empty-legs-core.reserve] rpc error', error);
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

  // Best-effort: confirmation email + capture leg_number for the
  // caller's revalidate. The email template self-censors the
  // price when ENABLE_EMPTY_LEGS_CLIENT_PRICING is off.
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
      .eq('id', clientId)
      .maybeSingle();

    const leg = legData as {
      leg_number?: string;
      departure_airport?: string | null;
      arrival_airport?: string | null;
      departure_airport_freeform_snapshot?: string | null;
      arrival_airport_freeform_snapshot?: string | null;
    } | null;
    const cli = clientData as { full_name?: string; auth_email?: string } | null;

    if (leg?.leg_number) legNumber = leg.leg_number;

    if (leg && cli && cli.auth_email) {
      const routeFrom =
        leg.departure_airport || leg.departure_airport_freeform_snapshot || '—';
      const routeTo =
        leg.arrival_airport || leg.arrival_airport_freeform_snapshot || '—';
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
    console.error(
      '[empty-legs-core.reserve] confirmation email/leg_number lookup failed (non-fatal)',
      err
    );
  }

  return {
    ok: true,
    leg_id: result.leg_id,
    reserved_at: result.reserved_at,
    expires_at: result.expires_at,
    price_at_reservation: result.price_at_reservation,
    leg_number: legNumber,
  };
}

// ============================================================
// Release (§4.6)
// ============================================================

export type RunReleaseEmptyLegResult =
  | { ok: true; leg_id: string; released_at: string; leg_number: string | null }
  | EmptyLegCoreFailure;

export async function runReleaseEmptyLeg(
  clientId: string,
  input: { leg_id: string }
): Promise<RunReleaseEmptyLegResult> {
  if (isEmptyLegsPortalDisabled()) return { ok: false, error: 'flag_disabled' };

  const parsed = cancelMyEmptyLegReservationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const client = looseClient();
  const { data, error } = await client.rpc(
    'release_empty_leg_reservation_for_client',
    { p_leg_id: parsed.data.leg_id, p_client_id: clientId }
  );
  if (error) {
    console.error('[empty-legs-core.release] rpc error', error);
    return { ok: false, error: 'server_error' };
  }

  const result = data as
    | { ok: true; leg_id: string; released_at: string }
    | { ok: false; error: string };
  if (!result.ok) return { ok: false, error: result.error };

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
      '[empty-legs-core.release] leg_number lookup failed (non-fatal)',
      err
    );
  }

  return {
    ok: true,
    leg_id: result.leg_id,
    released_at: result.released_at,
    leg_number: legNumber,
  };
}

// ============================================================
// Price alerts (mobile core — reuses shared validators + RPCs)
// ============================================================

export type AlertMutationResult = { ok: true } | EmptyLegCoreFailure;

export async function runListClientAlerts(
  clientId: string
): Promise<ClientEmptyLegAlertRow[]> {
  return listClientAlerts(clientId);
}

export async function runCreateClientAlert(
  clientId: string,
  rawInput: unknown
): Promise<AlertMutationResult> {
  const parsed = createAlertSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const { data, error } = await looseClient().rpc(
    'create_client_empty_leg_alert',
    {
      p_client_id: clientId,
      p_origin: parsed.data.origin_iata,
      p_destination: parsed.data.destination_iata,
      p_max_price: parsed.data.max_price_sar,
      p_date_from: parsed.data.date_from,
      p_date_to: parsed.data.date_to,
      p_channels: ['email'],
    }
  );
  if (error) {
    console.error('[empty-legs-core.alert-create] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  // NULL ⇒ the SECURITY DEFINER guard rejected (bad IATA / same route).
  if (!data) return { ok: false, error: 'alert_invalid' };
  return { ok: true };
}

export async function runSetClientAlertActive(
  clientId: string,
  input: { alert_id: string; active: boolean }
): Promise<AlertMutationResult> {
  const parsed = alertIdSchema.safeParse({ alert_id: input.alert_id });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  const { error } = await looseClient().rpc(
    'set_client_empty_leg_alert_active',
    {
      p_alert_id: parsed.data.alert_id,
      p_client_id: clientId,
      p_active: input.active,
    }
  );
  if (error) {
    console.error('[empty-legs-core.alert-set-active] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return { ok: true };
}

export async function runDeleteClientAlert(
  clientId: string,
  input: { alert_id: string }
): Promise<AlertMutationResult> {
  const parsed = alertIdSchema.safeParse({ alert_id: input.alert_id });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation_failed',
      field_errors: fieldErrorsFromZod(parsed.error.issues),
    };
  }
  const { error } = await looseClient().rpc('delete_client_empty_leg_alert', {
    p_alert_id: parsed.data.alert_id,
    p_client_id: clientId,
  });
  if (error) {
    console.error('[empty-legs-core.alert-delete] rpc error', error);
    return { ok: false, error: 'rpc_failed' };
  }
  return { ok: true };
}
