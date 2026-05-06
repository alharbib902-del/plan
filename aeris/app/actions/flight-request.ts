'use server';

import {
  flightRequestSchema,
  type FlightRequestInput,
} from '@/lib/validators/trip-request';
import { buildFlightRequestWhatsAppLink } from '@/lib/utils/whatsapp';
import { insertLead } from '@/lib/supabase/queries/leads';
import { notifyAdminOfNewLead } from '@/lib/notifications/lead-email';
import { assertKnownAirport } from '@/lib/supabase/queries/airports';
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
  // Honeypot — silently accept and drop bot submissions.
  const honeypot = (formData.get('hp_company') as string | null) ?? '';
  if (honeypot.trim().length > 0) {
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
  };

  const parsed = flightRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'form';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
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
    return { ok: false, fieldErrors: { origin: 'origin_iata_unknown' } };
  }
  const destinationResolved = await resolveAirportSide(
    data.destination_iata,
    data.destination_freeform
  );
  if (!destinationResolved.ok) {
    return {
      ok: false,
      fieldErrors: { destination: 'destination_iata_unknown' },
    };
  }

  const persistInput: ResolvedLeadInput = {
    data,
    originLabel: originResolved.label,
    destinationLabel: destinationResolved.label,
    originIata: originResolved.iata,
    destinationIata: destinationResolved.iata,
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

  return {
    ok: true,
    // No client-generated reference. If persistence failed, requestNumber stays null
    // and the success UI hides the reference paragraph entirely (Phase 2 plan, Codex iteration 2 fix #5).
    requestNumber: persisted && row ? row.request_number : null,
    whatsappUrl,
    persisted,
  };
}

