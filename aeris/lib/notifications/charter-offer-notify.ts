import 'server-only';

import { Resend } from 'resend';

import { resolveSiteUrl } from '@/lib/checkout/site-url';
import { runGetClientProfile } from '@/lib/clients/core/profile-core';
import { getTripById } from '@/lib/supabase/queries/trips';
import { AIRCRAFT_CATEGORY_LABEL_AR } from '@/lib/validators/promote-lead';
import type { AircraftCategoryValue, TripRequestRow } from '@/types/database';

import {
  buildClientOfferReceivedEmail,
  buildClientOfferReceivedWhatsAppBody,
  buildFounderNewClientRequestEmail,
  buildFounderOfferReceivedEmail,
  buildGuestOfferReceivedWhatsAppBody,
  resolveRouteEndpoints,
  type BuiltEmail,
} from './charter-offer-templates';
import { normaliseSaudiPhoneE164, sendWhatsAppMessage } from './whatsapp-provider';

/**
 * Inline (awaited) like the empty-leg reservation alerts — a detached
 * promise can be frozen with the serverless function once the action
 * returns — but bounded by NOTIFY_BUDGET_MS so a slow provider never
 * holds the operator's / client's submit open. Every path is
 * fail-soft: missing config is a silent no-op and nothing throws to
 * the caller.
 */
const NOTIFY_BUDGET_MS = 6000;

async function withinBudget(work: Promise<unknown>, tag: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), NOTIFY_BUDGET_MS);
  });
  try {
    const outcome = await Promise.race([work.then(() => 'done' as const), budget]);
    if (outcome === 'timeout') {
      console.warn(`[charter-offer-notify] ${tag} exceeded ${NOTIFY_BUDGET_MS}ms budget; returning early`);
    }
  } catch (err) {
    console.error(`[charter-offer-notify] ${tag} failed (non-fatal)`, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Same channel + recipient resolution as notifyAdminOfEmptyLegReservation. */
async function sendFounderAlertEmail(email: BuiltEmail, tag: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes('xxxxxxxxxxx')) return;
  const from = process.env.RESEND_FROM_EMAIL || 'noreply@aeris.sa';
  const to = process.env.LEAD_NOTIFICATION_TO || from;
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to, subject: email.subject, html: email.html });
    if (result.error) {
      console.error(`[charter-offer-notify] ${tag} founder email rejected`, result.error.message);
    }
  } catch (err) {
    console.error(`[charter-offer-notify] ${tag} founder email failed`, err);
  }
}

/** Same env contract as the other client emails (client-email.ts). */
async function sendClientEmail(to: string, email: BuiltEmail, tag: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to.trim()) return;
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to, subject: email.subject, html: email.html });
    if (result.error) {
      console.error(`[charter-offer-notify] ${tag} client email rejected`, result.error.message);
    }
  } catch (err) {
    console.error(`[charter-offer-notify] ${tag} client email failed`, err);
  }
}

async function sendWhatsApp(phone: string | null, text: string, tag: string): Promise<void> {
  const to = phone ? normaliseSaudiPhoneE164(phone) : null;
  if (!to) return;
  try {
    const wa = await sendWhatsAppMessage({ to, text });
    if (!wa.ok) {
      console.warn(`[charter-offer-notify] ${tag} WhatsApp skipped/failed`, wa.reason, wa.detail);
    }
  } catch (err) {
    console.error(`[charter-offer-notify] ${tag} WhatsApp threw`, err);
  }
}

async function loadTrip(tripRequestId: string): Promise<TripRequestRow | null> {
  try {
    return await getTripById(tripRequestId);
  } catch (err) {
    console.error('[charter-offer-notify] trip lookup failed', err);
    return null;
  }
}

async function loadClientContact(clientId: string): Promise<{
  full_name: string;
  contact_phone: string;
  auth_email: string;
} | null> {
  try {
    return await runGetClientProfile(clientId);
  } catch (err) {
    console.error('[charter-offer-notify] client lookup failed', err);
    return null;
  }
}

export interface NotifyCharterOfferSubmittedInput {
  trip_request_id: string;
  operator_name: string;
  total_price_sar: number;
  aircraft_type: string | null;
  aircraft_registration: string | null;
}

/**
 * After an operator's offer is persisted (phase4 v=1 or phase5 v=2):
 * founder alert + client «وصلك عرض جديد» (email + WhatsApp) for
 * signed-in requests, or a price-free WhatsApp heads-up for guest leads.
 */
export async function notifyCharterOfferSubmitted(
  input: NotifyCharterOfferSubmittedInput
): Promise<void> {
  const work = (async () => {
    const trip = await loadTrip(input.trip_request_id);
    if (!trip) return;

    const siteUrl = resolveSiteUrl();
    const route = resolveRouteEndpoints(trip);
    const client = trip.client_id ? await loadClientContact(trip.client_id) : null;
    const aircraft =
      [input.aircraft_type, input.aircraft_registration ? `(${input.aircraft_registration})` : null]
        .filter((part): part is string => Boolean(part))
        .join(' ') || null;

    const tasks: Promise<void>[] = [
      sendFounderAlertEmail(
        buildFounderOfferReceivedEmail({
          request_number: trip.request_number,
          route,
          departure_date: trip.departure_date,
          operator_name: input.operator_name,
          total_price_sar: input.total_price_sar,
          aircraft,
          customer_kind: trip.client_id ? 'client' : 'guest',
          customer_name: client?.full_name || trip.customer_name,
          customer_phone: client?.contact_phone || trip.customer_phone,
          admin_url: `${siteUrl}/admin/trips/${trip.id}`,
        }),
        'offer'
      ),
    ];

    if (trip.client_id) {
      if (client) {
        const clientInput = {
          full_name: client.full_name,
          request_number: trip.request_number,
          route,
          request_url: `${siteUrl}/me/requests/${trip.id}`,
        };
        tasks.push(
          sendClientEmail(client.auth_email, buildClientOfferReceivedEmail(clientInput), 'offer'),
          sendWhatsApp(client.contact_phone, buildClientOfferReceivedWhatsAppBody(clientInput), 'offer:client')
        );
      }
    } else {
      tasks.push(
        sendWhatsApp(
          trip.customer_phone,
          buildGuestOfferReceivedWhatsAppBody({
            customer_name: trip.customer_name,
            request_number: trip.request_number,
            route,
          }),
          'offer:guest'
        )
      );
    }

    await Promise.allSettled(tasks);
  })();

  await withinBudget(work, 'offer-submitted');
}

export interface NotifyFounderOfClientCharterRequestInput {
  trip_request_id: string;
  request_number: string;
  client_id: string;
  departure_iata: string;
  arrival_iata: string;
  departure_date: string;
  return_date: string | null;
  passengers: number;
  aircraft_pref: AircraftCategoryValue | null;
  special_requests: string | null;
  auto_distribution: boolean;
}

/** Founder alert for a new signed-in charter request (web + mobile). */
export async function notifyFounderOfClientCharterRequest(
  input: NotifyFounderOfClientCharterRequestInput
): Promise<void> {
  const work = (async () => {
    const client = await loadClientContact(input.client_id);
    await sendFounderAlertEmail(
      buildFounderNewClientRequestEmail({
        request_number: input.request_number,
        route: { from: input.departure_iata, to: input.arrival_iata },
        departure_date: input.departure_date,
        return_date: input.return_date,
        passengers: input.passengers,
        aircraft_pref_label: input.aircraft_pref ? AIRCRAFT_CATEGORY_LABEL_AR[input.aircraft_pref] : null,
        special_requests: input.special_requests,
        client_name: client?.full_name || null,
        client_phone: client?.contact_phone || null,
        client_email: client?.auth_email || null,
        auto_distribution: input.auto_distribution,
        admin_url: `${resolveSiteUrl()}/admin/trips/${input.trip_request_id}`,
      }),
      'client-request'
    );
  })();

  await withinBudget(work, 'client-request');
}
