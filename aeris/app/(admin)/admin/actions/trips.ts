'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdminSession } from '@/lib/admin/auth';
import { issueOperatorToken } from '@/lib/operator/token';
import { promoteLeadSchema } from '@/lib/validators/promote-lead';
import { dispatchTripSchema } from '@/lib/validators/dispatch';
import { getLeadById } from '@/lib/supabase/queries/leads';
import {
  acceptOperatorOffer,
  persistDispatchState,
  promoteLeadToTripRequest,
} from '@/lib/supabase/queries/trips';
import { normalizeWhatsAppPhone } from '@/lib/utils/format';
import { AERIS_CONTACT } from '@/lib/config/contact';
import type { TripLeg } from '@/types/database';

export type PromoteResult =
  | { ok: true; trip_request_id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'lead_not_found'
        | 'lead_not_promotable'
        | 'failed';
    };

export async function promoteLead(formData: FormData): Promise<PromoteResult> {
  requireAdminSession();

  const parsed = promoteLeadSchema.safeParse({
    lead_id: formData.get('lead_id'),
    aircraft_category: formData.get('aircraft_category'),
    special_requests: formData.get('special_requests'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  const lead = await getLeadById(parsed.data.lead_id);
  if (!lead) {
    return { ok: false, error: 'lead_not_found' };
  }

  const legs = buildLegsFromLead(lead);

  let result;
  try {
    result = await promoteLeadToTripRequest({
      p_lead_id: parsed.data.lead_id,
      p_legs: legs,
      p_aircraft_category: parsed.data.aircraft_category,
      p_special_requests: parsed.data.special_requests ?? null,
      p_lead_trip_type: lead.trip_type,
    });
  } catch (err) {
    console.error('[trips-action] promoteLead RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath('/admin/leads');
  revalidatePath(`/admin/leads/${parsed.data.lead_id}`);
  revalidatePath('/admin/trips');
  redirect(`/admin/trips/${result.trip_request_id}`);
}

function buildLegsFromLead(lead: {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string | null;
  trip_type: 'one_way' | 'round_trip' | 'multi_city';
}): TripLeg[] {
  const outbound: TripLeg = {
    from: lead.origin,
    to: lead.destination,
    date: lead.departure_date,
    time: null,
  };
  if (lead.trip_type === 'round_trip' && lead.return_date) {
    return [
      outbound,
      {
        from: lead.destination,
        to: lead.origin,
        date: lead.return_date,
        time: null,
      },
    ];
  }
  // multi_city in Phase 4 stores a single primary leg; admin must
  // edit before dispatch (see CLAUDE-TASK.md §2 multi-city note).
  return [outbound];
}

export interface DispatchResultOk {
  ok: true;
  operator_url: string;
  whatsapp_link: string;
  expires_at: string;
}

export type DispatchResult =
  | DispatchResultOk
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'env_missing'
        | 'failed';
    };

export async function dispatchTrip(formData: FormData): Promise<DispatchResult> {
  requireAdminSession();

  const parsed = dispatchTripSchema.safeParse({
    trip_request_id: formData.get('trip_request_id'),
    operator_phone: formData.get('operator_phone'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  let issued;
  try {
    issued = issueOperatorToken({
      tripRequestId: parsed.data.trip_request_id,
    });
  } catch (err) {
    console.error('[trips-action] issueOperatorToken failed', err);
    return { ok: false, error: 'env_missing' };
  }

  const expiresAtIso = new Date(issued.payload.expires_at * 1000).toISOString();

  try {
    await persistDispatchState({
      tripRequestId: parsed.data.trip_request_id,
      nonce: issued.payload.nonce,
      expiresAt: expiresAtIso,
      targetPhone: parsed.data.operator_phone,
    });
  } catch (err) {
    console.error('[trips-action] persistDispatchState failed', err);
    return { ok: false, error: 'failed' };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') || 'https://aeris.sa';
  const operatorUrl = `${siteUrl}/operator/offer/${issued.token}`;
  const whatsappLink = buildOperatorWhatsAppLink(
    parsed.data.operator_phone,
    operatorUrl
  );

  revalidatePath(`/admin/trips/${parsed.data.trip_request_id}`);
  revalidatePath('/admin/trips');
  return {
    ok: true,
    operator_url: operatorUrl,
    whatsapp_link: whatsappLink,
    expires_at: expiresAtIso,
  };
}

function buildOperatorWhatsAppLink(
  operatorPhoneE164: string,
  operatorUrl: string
): string {
  const digits = normalizeWhatsAppPhone(operatorPhoneE164);
  const message = [
    'مرحباً،',
    'هذه دعوة لتقديم عرض على رحلة خاصة عبر منصة Aeris.',
    '',
    `الرابط: ${operatorUrl}`,
    '',
    `للاستفسار: wa.me/${AERIS_CONTACT.whatsappNumber}`,
  ].join('\n');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export type AcceptResult =
  | { ok: true; trip_request_id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'offer_expired'
        | 'offer_not_pending'
        | 'trip_not_open'
        | 'failed';
    };

export async function acceptOffer(formData: FormData): Promise<AcceptResult> {
  requireAdminSession();

  const offerId = formData.get('offer_id');
  if (typeof offerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(offerId)) {
    return { ok: false, error: 'invalid_input' };
  }

  let result;
  try {
    result = await acceptOperatorOffer({ p_offer_id: offerId });
  } catch (err) {
    console.error('[trips-action] acceptOffer RPC failed', err);
    return { ok: false, error: 'failed' };
  }

  if (!result.ok) {
    revalidatePath('/admin/trips');
    return { ok: false, error: result.error };
  }

  revalidatePath('/admin/trips');
  revalidatePath(`/admin/trips/${result.trip_request_id}`);
  return { ok: true, trip_request_id: result.trip_request_id };
}
