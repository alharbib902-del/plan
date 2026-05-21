'use server';

import {
  flightRequestSchema,
  type FlightRequestInput,
} from '@/lib/validators/trip-request';
import {
  mergeTripPreferences,
  type TripPreferences,
} from '@/lib/validators/trip-preferences';
import { buildFlightRequestWhatsAppLink } from '@/lib/utils/whatsapp';
import { insertLead } from '@/lib/supabase/queries/leads';
import { notifyAdminOfNewLead } from '@/lib/notifications/lead-email';
import { assertKnownAirport } from '@/lib/supabase/queries/airports';
import {
  checkPublicActionRateLimit,
  recordPublicActionAttempt,
} from '@/lib/rate-limit/public-action';
import type { LeadInquiryRow } from '@/types/database';

export type FlightRequestActionResult =
  | {
      ok: true;
      requestNumber: string | null;
      whatsappUrl: string;
      persisted: boolean;
    }
  | {
      ok: false;
      fieldErrors: Record<string, string>;
      formError?: string;
    };

interface PersistOutcome {
  persisted: boolean;
  row: LeadInquiryRow | null;
}

interface ResolvedLeadInput {
  data: FlightRequestInput;
  originLabel: string;
  destinationLabel: string;
  originIata: string | null;
  destinationIata: string | null;
  preferences: TripPreferences;
  // Phase 7 PR 2d (Codex iteration-1 P1 #1 fix): the
  // empty-legs opt-in checkbox is unchecked by default;
  // we only flip the column to TRUE when the customer
  // ticks it explicitly. An unticked submission lets
  // the schema default FALSE stand.
  emptyLegsOptIn: boolean;
}

async function tryPersistLead(
  input: ResolvedLeadInput
): Promise<PersistOutcome> {
  try {
    const { row } = await insertLead({
      customer_name: input.data.customerName,
      customer_phone: input.data.customerPhone,
      trip_type: input.data.tripType,
      origin: input.originLabel,
      destination: input.destinationLabel,
      origin_iata: input.originIata,
      destination_iata: input.destinationIata,
      departure_date: input.data.departureDate,
      return_date: input.data.returnDate ?? null,
      passengers: input.data.passengers,
      notes: input.data.notes ?? null,
      source: 'website',
      preferences: input.preferences,
      empty_legs_opt_in: input.emptyLegsOptIn,
    });
    return { persisted: true, row };
  } catch (err) {
    console.error('[flight-request] persistence failed', err);
    return { persisted: false, row: null };
  }
}

/**
 * Resolve a side ("origin" / "destination") into a display
 * label + validated IATA. Phase 6.0 PR 2 (S3 + acceptance #6):
 * unknown IATA codes are rejected here via assertKnownAirport
 * — Zod can't reach the DB, so this is the second half of the
 * sync (regex) + async (FK) validator chain.
 */
async function resolveAirportSide(
  iata: string | null | undefined,
  freeform: string | null | undefined
): Promise<
  | { ok: true; label: string; iata: string | null }
  | { ok: false; code: 'iata_unknown' }
> {
  if (iata) {
    try {
      const airport = await assertKnownAirport(iata);
      return {
        ok: true,
        iata: airport.iata_code,
        label: `${airport.city_ar ?? airport.city} (${airport.iata_code})`,
      };
    } catch {
      return { ok: false, code: 'iata_unknown' };
    }
  }
  // freeform path — validator already enforced length 2..120
  // and ensured exactly one of (iata, freeform) is set.
  return { ok: true, iata: null, label: freeform ?? '' };
}

export async function submitFlightRequest(
  formData: FormData
): Promise<FlightRequestActionResult> {
  // Rate-limit FIRST (before honeypot) so bot abuse can't burn
  // through validation cycles without consuming budget. The
  // check itself does one indexed SELECT against
  // public_action_attempts; cost is negligible.
  const rl = await checkPublicActionRateLimit('flight_request');
  if (!rl.ok) {
    // Don't double-record on storage/secret errors — we want
    // those to fail-closed without polluting the ledger with
    // synthetic rate_limited rows.
    if (rl.reason !== 'storage_error' && rl.reason !== 'secret_missing') {
      await recordPublicActionAttempt(
        'flight_request',
        rl.actorFingerprint,
        'rate_limited'
      );
    }
    return {
      ok: false,
      fieldErrors: {},
      formError: 'rate_limited',
    };
  }

  // Honeypot — silently accept and drop bot submissions, but
  // STILL count toward the rate-limit budget so a bot that keeps
  // tripping it eventually hits the lockout.
  const honeypot = (formData.get('hp_company') as string | null) ?? '';
  if (honeypot.trim().length > 0) {
    await recordPublicActionAttempt(
      'flight_request',
      rl.actorFingerprint,
      'honeypot'
    );
    return {
      ok: true,
      requestNumber: null,
      whatsappUrl: buildFlightRequestWhatsAppLink({
        data: {
          origin_iata: null,
          origin_freeform: null,
          destination_iata: null,
          destination_freeform: null,
          departureDate: new Date().toISOString().slice(0, 10),
          returnDate: undefined,
          passengers: 1,
          tripType: 'one_way',
          customerName: '',
          customerPhone: '',
          notes: undefined,
        } as FlightRequestInput,
        originLabel: '',
        destinationLabel: '',
      }),
      persisted: false,
    };
  }

  // Phase 6.1 PR 2: preferences arrive as a single
  // JSON-stringified field. Empty string (collapsible
  // section never opened, or all fields cleared) becomes
  // an empty object before validation.
  const preferencesRaw = formData.get('preferences');
  let preferencesCandidate: unknown = {};
  if (typeof preferencesRaw === 'string' && preferencesRaw.trim().length > 0) {
    try {
      preferencesCandidate = JSON.parse(preferencesRaw);
    } catch {
      return {
        ok: false,
        fieldErrors: { preferences: 'preferences_invalid' },
      };
    }
  }

  const raw = {
    origin_iata: formData.get('origin_iata'),
    origin_freeform: formData.get('origin_freeform'),
    destination_iata: formData.get('destination_iata'),
    destination_freeform: formData.get('destination_freeform'),
    departureDate: formData.get('departureDate'),
    returnDate: formData.get('returnDate'),
    passengers: formData.get('passengers'),
    tripType: formData.get('tripType'),
    customerName: formData.get('customerName'),
    customerPhone: formData.get('customerPhone'),
    notes: formData.get('notes'),
    preferences: preferencesCandidate,
  };

  const parsed = flightRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'form';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    await recordPublicActionAttempt(
      'flight_request',
      rl.actorFingerprint,
      'validation_failed'
    );
    return { ok: false, fieldErrors };
  }

  const data = parsed.data;

  // Phase 6.0 PR 2: resolve each side into (display label,
  // validated IATA-or-null). Async DB lookup against the
  // airports table — surfaces unknown-IATA rejection per
  // acceptance #6.
  const originResolved = await resolveAirportSide(
    data.origin_iata,
    data.origin_freeform
  );
  if (!originResolved.ok) {
    await recordPublicActionAttempt(
      'flight_request',
      rl.actorFingerprint,
      'validation_failed'
    );
    return { ok: false, fieldErrors: { origin: 'origin_iata_unknown' } };
  }
  const destinationResolved = await resolveAirportSide(
    data.destination_iata,
    data.destination_freeform
  );
  if (!destinationResolved.ok) {
    await recordPublicActionAttempt(
      'flight_request',
      rl.actorFingerprint,
      'validation_failed'
    );
    return {
      ok: false,
      fieldErrors: { destination: 'destination_iata_unknown' },
    };
  }

  // Phase 6.1 PR 2: enforce the canonical "key omission =
  // no preference" rule. mergeTripPreferences strips
  // null / undefined / empty-array / empty-string values
  // from the incoming object. The result is exactly the
  // shape the JSONB column should hold (lib/validators/
  // trip-preferences.ts canonical rule).
  const cleanedPreferences = mergeTripPreferences(
    {},
    data.preferences ?? {}
  );

  // Phase 7 PR 2d: read the explicit opt-in flag from the
  // form. HTML <input type="checkbox"> sends the field with
  // value 'on' when ticked, omits it entirely when unticked,
  // so a `null` means "not ticked".
  const emptyLegsOptInRaw = formData.get('empty_legs_opt_in');
  const emptyLegsOptIn =
    typeof emptyLegsOptInRaw === 'string' &&
    (emptyLegsOptInRaw === 'on' || emptyLegsOptInRaw === 'true');

  const persistInput: ResolvedLeadInput = {
    data,
    originLabel: originResolved.label,
    destinationLabel: destinationResolved.label,
    originIata: originResolved.iata,
    destinationIata: destinationResolved.iata,
    preferences: cleanedPreferences,
    emptyLegsOptIn,
  };

  const { persisted, row } = await tryPersistLead(persistInput);

  // Best-effort founder notification. Never blocks the submission.
  if (persisted && row) {
    try {
      await notifyAdminOfNewLead(row);
    } catch (err) {
      console.error('[flight-request] notify failed', err);
    }
  }

  const whatsappUrl = buildFlightRequestWhatsAppLink({
    data,
    originLabel: persistInput.originLabel,
    destinationLabel: persistInput.destinationLabel,
  });

  // Record the terminal outcome. A persistence failure still
  // returns ok:true to the user (the WhatsApp deep-link works
  // either way), but we log the rpc_error for canary triage +
  // so it counts toward the rate-limit budget for replay storms.
  await recordPublicActionAttempt(
    'flight_request',
    rl.actorFingerprint,
    persisted ? 'success' : 'rpc_error'
  );

  return {
    ok: true,
    // No client-generated reference. If persistence failed, requestNumber stays null
    // and the success UI hides the reference paragraph entirely (Phase 2 plan, Codex iteration 2 fix #5).
    requestNumber: persisted && row ? row.request_number : null,
    whatsappUrl,
    persisted,
  };
}

