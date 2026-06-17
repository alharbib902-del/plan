import 'server-only';

import { GoogleAuth } from 'google-auth-library';

import { clientPricingVisible } from '@/lib/empty-legs/pricing-visibility';
import { createAdminClient } from '@/lib/supabase/admin';

import { claimPushDelivery, markPushDelivery } from './deliveries';
import {
  deleteDeviceTokenByPlaintext,
  listClientDeviceTokens,
} from './device-tokens';
import {
  aggregateDeliveryStatus,
  classifyFcmResult,
  nextRetryAt,
  type FcmTokenOutcome,
} from './fcm-error';
import { buildEmptyLegPushTemplate } from './push-templates';
import { recordClientPushAlertStatus } from './push-alert-status';

/**
 * Push PR3b — FCM HTTP v1 sender for the empty-leg push channel. Entirely
 * FAIL-SOFT: it never throws into the matcher (enqueueClientLegNotifications),
 * and is only invoked behind ENABLE_PUSH_NOTIFICATIONS. Lifecycle:
 *   claim → (creds/auth) → fan-out to the client's device tokens → mark + cleanup.
 * Idempotency + retry live in the DB (PR3a); creds/auth faults AFTER a claim
 * mark the row failed_transient (with backoff) + flag config_missing so a retry
 * sweep re-tries once creds are fixed (founder P1).
 */

interface FcmCreds {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

function readFcmCreds(): FcmCreds | null {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  // Vercel commonly stores the PEM with literal "\n" — normalise to newlines.
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

let cachedAuth: GoogleAuth | null = null;
function getAuth(creds: FcmCreds): GoogleAuth {
  cachedAuth ??= new GoogleAuth({
    credentials: { client_email: creds.clientEmail, private_key: creds.privateKey },
    projectId: creds.projectId,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  return cachedAuth;
}

async function sendOne(
  accessToken: string,
  projectId: string,
  token: string,
  notification: { title: string; body: string },
  data: Record<string, string>
): Promise<FcmTokenOutcome> {
  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: { token, notification, data } }),
      }
    );
    if (res.ok) return 'success';
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON error body — classify by status alone.
    }
    return classifyFcmResult(res.status, body);
  } catch (err) {
    console.error('[push.send] fetch threw (transient)', err);
    return 'transient';
  }
}

export interface DispatchPushArgs {
  clientId: string;
  legId: string;
  legNumber: string;
  eventType: 'published' | 'price_dropped';
  routeFrom: string;
  routeTo: string;
  currentPrice?: number | null;
}

export async function dispatchClientEmptyLegPush(
  args: DispatchPushArgs
): Promise<void> {
  try {
    const claim = await claimPushDelivery(
      args.clientId,
      args.legId,
      args.eventType
    );
    // Not claimed = already delivered / not due / RPC fault → nothing to do.
    if (!claim.ok || !claim.claimed) return;
    const { deliveryId, attempt } = claim;
    const ctx = `empty-leg-push:${args.eventType}`;
    const admin = createAdminClient();

    const creds = readFcmCreds();
    if (!creds) {
      await markPushDelivery(deliveryId, 'failed_transient', {
        lastError: 'fcm_config_missing',
        nextRetryAt: nextRetryAt(attempt, new Date()),
      });
      await recordClientPushAlertStatus(
        admin,
        { ok: false, reason: 'config_missing', detail: 'FCM_* env not set' },
        ctx
      );
      return;
    }

    let accessToken: string | null = null;
    try {
      accessToken = (await getAuth(creds).getAccessToken()) ?? null;
    } catch (err) {
      console.error('[push.auth] token mint failed', err);
    }
    if (!accessToken) {
      await markPushDelivery(deliveryId, 'failed_transient', {
        lastError: 'fcm_auth_failed',
        nextRetryAt: nextRetryAt(attempt, new Date()),
      });
      await recordClientPushAlertStatus(
        admin,
        { ok: false, reason: 'config_missing', detail: 'FCM OAuth mint failed' },
        ctx
      );
      return;
    }

    const tokens = await listClientDeviceTokens(args.clientId);
    if (tokens.length === 0) {
      // Nothing to send; the claim is consumed (terminal).
      await markPushDelivery(deliveryId, 'sent');
      return;
    }

    const { title, body } = buildEmptyLegPushTemplate({
      eventType: args.eventType,
      routeFrom: args.routeFrom,
      routeTo: args.routeTo,
      currentPrice: args.currentPrice,
      includePricing: clientPricingVisible(),
    });
    const data: Record<string, string> = {
      type: 'empty_leg',
      leg_number: args.legNumber,
      event_type: args.eventType,
    };

    const outcomes: FcmTokenOutcome[] = [];
    for (const dt of tokens) {
      const outcome = await sendOne(
        accessToken,
        creds.projectId,
        dt.token,
        { title, body },
        data
      );
      if (outcome === 'delete') await deleteDeviceTokenByPlaintext(dt.token);
      outcomes.push(outcome);
    }

    const agg = aggregateDeliveryStatus(outcomes);
    await markPushDelivery(
      deliveryId,
      agg.markStatus,
      agg.markStatus === 'failed_transient'
        ? {
            lastError: agg.configMissing ? 'fcm_config' : 'fcm_transient',
            nextRetryAt: nextRetryAt(attempt, new Date()),
          }
        : undefined
    );
    if (agg.configMissing) {
      await recordClientPushAlertStatus(
        admin,
        { ok: false, reason: 'config_missing', detail: 'FCM auth error mid-send' },
        ctx
      );
    } else if (agg.markStatus === 'sent') {
      await recordClientPushAlertStatus(admin, { ok: true }, ctx);
    }
    // failed_permanent / non-config transient: a per-device issue, not a
    // channel outage — leave the health singleton untouched.
  } catch (err) {
    // Absolute fail-soft: never break the email/wa matcher loop.
    console.error('[push.dispatch] unexpected (fail-soft)', err);
  }
}
