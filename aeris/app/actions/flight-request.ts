'use server';

import {
  flightRequestSchema,
  type FlightRequestInput,
} from '@/lib/validators/trip-request';
import { buildFlightRequestWhatsAppLink } from '@/lib/utils/whatsapp';
import { insertLead } from '@/lib/supabase/queries/leads';
import { notifyAdminOfNewLead } from '@/lib/notifications/lead-email';
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

async function tryPersistLead(
  data: FlightRequestInput
): Promise<PersistOutcome> {
  try {
    const { row } = await insertLead({
      customer_name: data.customerName,
      customer_phone: data.customerPhone,
      trip_type: data.tripType,
      origin: data.origin,
      destination: data.destination,
      departure_date: data.departureDate,
      return_date: data.returnDate ?? null,
      passengers: data.passengers,
      notes: data.notes ?? null,
      source: 'website',
    });
    return { persisted: true, row };
  } catch (err) {
    console.error('[flight-request] persistence failed', err);
    return { persisted: false, row: null };
  }
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
        origin: '',
        destination: '',
        departureDate: new Date().toISOString().slice(0, 10),
        returnDate: undefined,
        passengers: 1,
        tripType: 'one_way',
        customerName: '',
        customerPhone: '',
        notes: undefined,
      } as FlightRequestInput),
      persisted: false,
    };
  }

  const raw = {
    origin: formData.get('origin'),
    destination: formData.get('destination'),
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
  const { persisted, row } = await tryPersistLead(data);

  // Best-effort founder notification. Never blocks the submission.
  if (persisted && row) {
    try {
      await notifyAdminOfNewLead(row);
    } catch (err) {
      console.error('[flight-request] notify failed', err);
    }
  }

  const whatsappUrl = buildFlightRequestWhatsAppLink(data);

  return {
    ok: true,
    // No client-generated reference. If persistence failed, requestNumber stays null
    // and the success UI hides the reference paragraph entirely (Phase 2 plan, Codex iteration 2 fix #5).
    requestNumber: persisted && row ? row.request_number : null,
    whatsappUrl,
    persisted,
  };
}
