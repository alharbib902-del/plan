// Server-side ONLY — same rationale as matching.ts.
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSiteUrl } from '@/lib/checkout/site-url';
import type { EmptyLegRow } from '@/lib/empty-legs/types';

import type { CandidateRow, ClientCandidateRow } from './candidate-pool';
import { mintOptOutToken } from './opt-out-token';
import { buildLegPublishedWhatsAppBody } from './notification-templates/leg-published-whatsapp';
import { buildLegPriceDroppedWhatsAppBody } from './notification-templates/leg-price-dropped-whatsapp';
import { clientPricingVisible } from './pricing-visibility';
import { sendFounderBatchAlert } from './founder-batch-email';
import { isClientOptedIn } from '@/lib/clients/notification-preferences';
import { sendClientEmptyLegMatchEmail } from '@/lib/notifications/client-empty-leg-email';
import { flagOn } from '@/lib/config/feature-flags';
// NOTE: the FCM sender ('server-only' + google-auth) is imported DYNAMICALLY
// inside the push block below — a top-level import would pull 'server-only'
// into this module, which the tsx Layer-1 matcher tests (which import this
// file) can't resolve. Lazy import also keeps google-auth out of the bundle
// until push actually fires.

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
            includePricing: clientPricingVisible(),
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
            includePricing: clientPricingVisible(),
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

// ============================================================
// Phase 10 PR 1 — client-side dispatch
//
// Sibling of `enqueueLegNotifications` for the §4.2 client-loop.
// Per-client channel selection rules (round 4 P1 #1):
//   - opted in to BOTH → channel='email_and_wa', wa_url + email_url populated, dispatch both
//   - opted in to email ONLY → channel='email', email_url populated, wa_url NULL
//   - opted in to wa.me ONLY → channel='whatsapp_link', wa_url populated, email_url NULL
//   - opted OUT of both → no row written, no dispatch (skipped count returned)
//
// Single-row-per-(client, leg) dedupe preserved by the §3.2
// idx_empty_leg_notifications_client_leg_unique partial unique
// index. 23505 unique-violation handled the same way as the lead
// path (treated as successful skip).
//
// Match-email Resend dispatches route through
// `sendClientEmptyLegMatchEmail` which writes to the §3.6
// `client_empty_leg_alert_status` singleton via
// `recordClientEmptyLegAlertStatus` (round 7 P1 #2).
// ============================================================

export interface EnqueueClientLegNotificationsOptions {
  leg: EmptyLegRow;
  eventType: 'published' | 'price_dropped';
  candidates: ClientCandidateRow[];
}

export interface EnqueueClientLegNotificationsResult {
  written: EnqueuedRow[];
  /** Count of clients who passed candidate-pool + frequency-cap
   *  but were opted OUT of both channels (no row written). */
  skipped_preferences: number;
}

export function buildClientWaMeUrl(
  phoneE164: string,
  body: string
): string {
  return waMeUrl(phoneE164, body);
}

export async function enqueueClientLegNotifications({
  leg,
  eventType,
  candidates,
}: EnqueueClientLegNotificationsOptions): Promise<EnqueueClientLegNotificationsResult> {
  if (candidates.length === 0) return { written: [], skipped_preferences: 0 };

  const siteUrl = resolveSiteUrl();
  const routeFrom = legRouteLabel(
    leg.departure_airport,
    leg.departure_airport_freeform_snapshot
  );
  const routeTo = legRouteLabel(
    leg.arrival_airport,
    leg.arrival_airport_freeform_snapshot
  );
  // Phase 10: clients land on /me/empty-legs/<leg_number> (NOT
  // the public token URL — authenticated path per §1 J2).
  const legUrl = `${siteUrl}/me/empty-legs/${leg.leg_number}`;
  const currentPrice = leg.current_price ?? 0;
  const currentDiscountPct = leg.current_discount_pct ?? 0;

  const writtenRows: EnqueuedRow[] = [];
  // Codex round 2 PR #62 P2 #1 fix — track wa.me-bound rows
  // separately so the founder batch alert reports the count of
  // rows that actually need manual dispatch (channel ∈
  // {whatsapp_link, email_and_wa}). Email-only rows are
  // dispatched inline by sendClientEmptyLegMatchEmail and
  // marked outreach_sent_at=NOW(); they never appear in the
  // admin outreach queue, so counting them in the founder
  // alert would lie about pending work.
  let waBoundCount = 0;
  let skippedPreferencesCount = 0;
  const dbClient = createAdminClient();

  for (const cand of candidates) {
    // 1. Read opt-in preferences via §3.3 helper
    const wantsEmail = isClientOptedIn(
      cand.notification_preferences,
      'empty_legs',
      'email'
    );
    const wantsWa = isClientOptedIn(
      cand.notification_preferences,
      'empty_legs',
      'wa_link'
    );
    // Push (PR3b) — default opt-OUT (per-channel default). Computed BEFORE the
    // skip so a push-only client (email/wa off, push on) is NOT skipped.
    const wantsPush = isClientOptedIn(
      cand.notification_preferences,
      'empty_legs',
      'push'
    );

    // 2. Skip only when opted out of EVERY channel (incl. push).
    if (!wantsEmail && !wantsWa && !wantsPush) {
      skippedPreferencesCount++;
      continue;
    }

    // 2b. Push is an INDEPENDENT channel — no empty_leg_notifications row for
    //     push-only. Behind the flag. The dispatcher is internally fail-soft;
    //     the local try/catch is belt-and-suspenders so the email/wa matcher
    //     can NEVER be broken by a push fault (a throw would otherwise fail the
    //     outbox drain + re-storm the whole client loop).
    //     Throughput note: this awaits a claim + sequential per-token FCM POSTs
    //     per candidate; a large push-eligible pool should later move to a
    //     dedicated push-drain queue rather than the synchronous match loop.
    if (wantsPush && flagOn('ENABLE_PUSH_NOTIFICATIONS')) {
      try {
        const { dispatchClientEmptyLegPush } = await import(
          '@/lib/push/fcm-sender'
        );
        await dispatchClientEmptyLegPush({
          clientId: cand.client_id,
          legId: leg.id,
          legNumber: leg.leg_number,
          eventType,
          routeFrom,
          routeTo,
          currentPrice: leg.current_price,
        });
      } catch (err) {
        console.error('[notifications] push dispatch failed (non-fatal)', {
          client: cand.client_id,
          leg: leg.id,
          err,
        });
      }
    }

    // 2c. The empty_leg_notifications row + email/wa dispatch below run ONLY
    //     when one of those two channels is on; a push-only client gets no row
    //     (the admin outreach queue stays clean).
    if (!wantsEmail && !wantsWa) continue;

    // 3. Build body (same WhatsApp body templates as the lead
    //    path; the email body is built inside sendClientEmptyLegMatchEmail).
    const waBody =
      eventType === 'price_dropped'
        ? buildLegPriceDroppedWhatsAppBody({
            legNumber: leg.leg_number,
            routeFrom,
            routeTo,
            currentPrice,
            currentDiscountPct,
            legUrl,
            optOutUrl: `${siteUrl}/me/notifications`,
            customerName: cand.customer_name,
            includePricing: clientPricingVisible(),
          })
        : buildLegPublishedWhatsAppBody({
            legNumber: leg.leg_number,
            routeFrom,
            routeTo,
            currentPrice,
            currentDiscountPct,
            legUrl,
            optOutUrl: `${siteUrl}/me/notifications`,
            customerName: cand.customer_name,
            includePricing: clientPricingVisible(),
          });

    const waUrl = wantsWa
      ? buildClientWaMeUrl(cand.customer_phone, waBody)
      : null;

    // 4. Determine channel + URLs per the multi-channel row model
    let channel: 'whatsapp_link' | 'email' | 'email_and_wa';
    let dbWaUrl: string | null;
    let dbEmailUrl: string | null;
    if (wantsEmail && wantsWa) {
      channel = 'email_and_wa';
      dbWaUrl = waUrl;
      dbEmailUrl = legUrl;
    } else if (wantsEmail) {
      channel = 'email';
      dbWaUrl = null;
      dbEmailUrl = legUrl;
    } else {
      channel = 'whatsapp_link';
      dbWaUrl = waUrl;
      dbEmailUrl = null;
    }

    // 5. INSERT the empty_leg_notifications row (single
    //    row per client+leg per §3.2 unique index).
    //
    // Codex round 2 PR #62 P2 #1 fix: email-only rows have NO
    // manual outreach action. The Resend email below is dispatched
    // inline (later in this loop), so the row's outreach_sent_at
    // should be NOW() at INSERT time — otherwise the admin
    // outreach queue (filters WHERE outreach_sent_at IS NULL)
    // surfaces these as stale pending tasks with no wa.me URL
    // for the founder to dispatch from.
    //
    //   - whatsapp_link → outreach_sent_at = NULL (founder
    //     dispatches wa.me manually)
    //   - email_and_wa  → outreach_sent_at = NULL (founder still
    //     needs to dispatch wa.me; email auto-sent in parallel)
    //   - email         → outreach_sent_at = NOW() (auto-sent
    //     by sendClientEmptyLegMatchEmail below; no manual action)
    const insertOutreachSentAt =
      channel === 'email' ? new Date().toISOString() : null;

    const { data, error } = await dbClient
      .from(NOTIFICATIONS_TABLE)
      .insert({
        client_id: cand.client_id,
        lead_inquiry_id: null, // XOR check requires exactly-one
        leg_id: leg.id,
        event_type: eventType,
        channel,
        wa_url: dbWaUrl,
        email_url: dbEmailUrl,
        outreach_sent_at: insertOutreachSentAt,
        external_message_id: null,
        sent_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // 23505 = unique_violation. The §3.2 client_leg_unique
      // index already has a row for this (client, leg) — treat
      // as successful skip (mirrors lead path).
      if (error.code === '23505') continue;
      console.error('[notifications] client insert failed', {
        client: cand.client_id,
        leg: leg.id,
        err: error,
      });
      continue;
    }

    writtenRows.push({
      id: data.id,
      lead_inquiry_id: cand.client_id, // best-effort EnqueuedRow re-use
      leg_id: leg.id,
      wa_url: dbWaUrl ?? '',
    });

    // Track wa.me-bound rows for the founder alert count
    // (Codex round 2 P2 #1 — email-only rows are auto-sent and
    // marked outreach_sent_at=NOW; they don't appear in the
    // admin outreach queue, so don't count them as "pending").
    if (channel === 'whatsapp_link' || channel === 'email_and_wa') {
      waBoundCount++;
    }

    // 6. Dispatch the email if requested. Fire-and-forget (no
    //    await on the alert recording — sendClientEmptyLegMatchEmail
    //    handles its own structured-error contract internally).
    if (wantsEmail) {
      try {
        await sendClientEmptyLegMatchEmail({
          client: {
            id: cand.client_id,
            full_name: cand.customer_name ?? '',
            auth_email: '', // resolved inside the helper from clients table
            contact_phone: cand.customer_phone,
          },
          leg,
          eventType,
          legUrl,
        });
      } catch (err) {
        console.error(
          '[notifications] client email dispatch failed (non-fatal)',
          { client: cand.client_id, leg: leg.id, err }
        );
      }
    }
    // wa.me: no per-row dispatch — the wa_url is collected
    // into the founder's batch alert below (founder messages
    // clients manually from the admin outreach queue, mirroring
    // the lead path).
  }

  // Codex round 1 PR #62 P1 #2 fix — fire the founder batch
  // alert for client rows too. Without this, clients opted into
  // wa_link only (or email_and_wa) get an empty_leg_notifications
  // row but the founder never gets a "new client matches pending"
  // surface, so the wa.me URLs sit in the table without delivery.
  // Mirrors the Phase 7 lead-path call at the bottom of
  // enqueueLegNotifications. Two emails per matching cycle (one
  // for the lead batch, one for the client batch) is intentional —
  // they summarise different recipient pools and surface in the
  // same /admin/empty-legs/outreach-queue page where the founder
  // dispatches both manually.
  //
  // Codex round 2 PR #62 P2 #1 fix — only fire when there are
  // actually wa.me-bound rows pending. If every written row was
  // email-only (auto-sent + outreach_sent_at=NOW), the founder
  // doesn't need a "new pending wa.me actions" alert because
  // none are pending; the email auto-dispatch already happened
  // and is tracked via §3.6 client_empty_leg_alert_status singleton.
  if (waBoundCount > 0) {
    try {
      await sendFounderBatchAlert({
        legId: leg.id,
        legNumber: leg.leg_number,
        rowCount: waBoundCount,
      });
    } catch (err) {
      // sendFounderBatchAlert is fail-tolerant: it logs +
      // updates the alert-status singleton on its own. Re-thrown
      // errors here would back the matcher into client_loop_failed
      // (round 1 P1 #1 fix) and trigger an outbox retry that
      // would re-fire the founder alert — undesirable since the
      // empty_leg_notifications rows ARE already written and
      // visible in the outreach queue.
      console.error(
        '[notifications] founder batch alert (client) failed (non-fatal)',
        err
      );
    }
  }

  return {
    written: writtenRows,
    skipped_preferences: skippedPreferencesCount,
  };
}
