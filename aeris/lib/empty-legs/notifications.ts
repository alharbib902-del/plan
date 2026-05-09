// Server-side ONLY — same rationale as matching.ts.
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSiteUrl } from '@/lib/checkout/site-url';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

import type { CandidateRow } from './candidate-pool';
import { mintOptOutToken } from './opt-out-token';
import { buildLegPublishedWhatsAppBody } from './notification-templates/leg-published-whatsapp';
import { buildLegPriceDroppedWhatsAppBody } from './notification-templates/leg-price-dropped-whatsapp';
import { sendFounderBatchAlert } from './founder-batch-email';

/**
 * Phase 7 PR 2e — wa.me URL emitter + outreach-queue
 * writer + founder batch alert trigger.
 *
 * Per Codex iteration-4 P1 #1, every match cycle:
 *   1. Composes a wa.me URL containing a pre-filled
 *      Arabic-RTL message body (see
 *      `notification-templates/`). The body references the
 *      leg number, route, current price, current discount,
 *      the marketplace deep-link, and the opt-out URL.
 *   2. INSERTs one row per (lead, leg) pair into
 *      `empty_leg_notifications` with `wa_url = <URL>`,
 *      `outreach_sent_at = NULL` (the row enters the
 *      queue pending the founder's manual dispatch),
 *      `external_message_id = NULL`, `sent_at = NOW()`.
 *      The unique `(lead_inquiry_id, leg_id)` index from
 *      PR 1 §13 is the authoritative dedupe; the
 *      application-level `frequency-cap.ts` filter is the
 *      friendly first line.
 *   3. After all rows for the cycle are written, calls
 *      `lib/empty-legs/founder-batch-email.ts` with the
 *      cycle's leg id; that module sends ONE batched
 *      Resend email to the founder.
 *
 * Customer-side email channel REMAINS REMOVED per Codex
 * iteration-2 P1 #2. wa.me is the only customer channel.
 */

const NOTIFICATIONS_TABLE = 'empty_leg_notifications';

export interface EnqueueLegNotificationsOptions {
  leg: EmptyLegRow;
  eventType: 'published' | 'price_dropped';
  candidates: CandidateRow[];
}

export interface EnqueuedRow {
  id: string;
  lead_inquiry_id: string;
  leg_id: string;
  wa_url: string;
}

function legRouteLabel(
  iata: string | null,
  freeform: string | null
): string {
  if (iata && iata.trim().length > 0) return iata;
  if (freeform && freeform.trim().length > 0) return freeform;
  return '—';
}

function legDeepLink(legNumber: string, siteUrl: string): string {
  return `${siteUrl}/empty-legs/${legNumber}`;
}

function optOutDeepLink(token: string, siteUrl: string): string {
  return `${siteUrl}/empty-legs/opt-out/${token}`;
}

function waMeUrl(phoneE164: string, body: string): string {
  // wa.me expects the phone WITHOUT the leading `+`. Strip
  // anything non-digit defensively.
  const phoneDigits = phoneE164.replace(/[^0-9]/g, '');
  const encoded = encodeURIComponent(body);
  return `https://wa.me/${phoneDigits}?text=${encoded}`;
}

export async function enqueueLegNotifications({
  leg,
  eventType,
  candidates,
}: EnqueueLegNotificationsOptions): Promise<EnqueuedRow[]> {
  if (candidates.length === 0) return [];

  const siteUrl = resolveSiteUrl();
  const routeFrom = legRouteLabel(
    leg.departure_airport,
    leg.departure_airport_freeform_snapshot
  );
  const routeTo = legRouteLabel(
    leg.arrival_airport,
    leg.arrival_airport_freeform_snapshot
  );
  const legUrl = legDeepLink(leg.leg_number, siteUrl);
  const currentPrice = leg.current_price ?? 0;
  const currentDiscountPct = leg.current_discount_pct ?? 0;

  const writtenRows: EnqueuedRow[] = [];
  const client = createAdminClient();

  // Per-candidate INSERT — keeps the unique-index
  // dedupe authoritative. A bulk INSERT would lose the
  // per-row idempotence on conflict; we want each
  // failure to NOT block siblings.
  for (const cand of candidates) {
    let optOutToken: string;
    try {
      optOutToken = mintOptOutToken({
        leadInquiryId: cand.id,
      }).token;
    } catch (err) {
      console.error(
        '[notifications] mintOptOutToken failed; skipping candidate',
        { lead: cand.id, err }
      );
      continue;
    }
    const optOutUrl = optOutDeepLink(optOutToken, siteUrl);

    const body =
      eventType === 'price_dropped'
        ? buildLegPriceDroppedWhatsAppBody({
            legNumber: leg.leg_number,
            routeFrom,
            routeTo,
            currentPrice,
            currentDiscountPct,
            legUrl,
            optOutUrl,
            customerName: cand.customer_name,
          })
        : buildLegPublishedWhatsAppBody({
            legNumber: leg.leg_number,
            routeFrom,
            routeTo,
            currentPrice,
            currentDiscountPct,
            legUrl,
            optOutUrl,
            customerName: cand.customer_name,
          });
    const url = waMeUrl(cand.customer_phone, body);

    const { data, error } = await client
      .from(NOTIFICATIONS_TABLE)
      .insert({
        lead_inquiry_id: cand.id,
        leg_id: leg.id,
        event_type: eventType,
        channel: 'whatsapp_link',
        wa_url: url,
        outreach_sent_at: null,
        external_message_id: null,
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // 23505 = unique_violation. The dedupe index from
      // PR 1 §13 already has a row for this (lead, leg) —
      // treat as a successful skip per Codex iteration-5
      // P2 #1 contract.
      if (error.code === '23505') continue;
      console.error('[notifications] insert failed', {
        lead: cand.id,
        leg: leg.id,
        err: error,
      });
      continue;
    }

    writtenRows.push({
      id: data.id,
      lead_inquiry_id: cand.id,
      leg_id: leg.id,
      wa_url: url,
    });
  }

  if (writtenRows.length > 0) {
    try {
      await sendFounderBatchAlert({
        legId: leg.id,
        legNumber: leg.leg_number,
        rowCount: writtenRows.length,
      });
    } catch (err) {
      // sendFounderBatchAlert is fail-tolerant: it logs
      // structured errors + updates the alert-status
      // singleton on its own. Re-thrown errors here would
      // back the matcher into the `enqueue_failed` branch
      // and prevent the outbox row from being marked
      // processed — undesirable since the
      // `empty_leg_notifications` rows ARE already
      // written.
      console.error(
        '[notifications] founder batch alert failed (non-fatal)',
        err
      );
    }
  }

  return writtenRows;
}
