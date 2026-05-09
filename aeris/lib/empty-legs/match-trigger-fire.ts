// Server-side ONLY — invoked from Server Actions only.
import { resolveSiteUrl } from '@/lib/checkout/site-url';

/**
 * Phase 7 PR 2e — fire-and-forget POST helper for the
 * synchronous match-trigger contract (Codex iteration-2
 * P2 #1 + iteration-3 P1 #1).
 *
 * Both `adminPublishEmptyLeg` (PR 2b) and
 * `operatorPublishEmptyLeg` (PR 2c) call this helper
 * after a successful `publish_empty_leg` RPC. The helper
 * fires a POST to `/api/empty-legs/internal/match-trigger`
 * with the new leg id and returns IMMEDIATELY without
 * awaiting the response — the publish form's latency
 * budget stays bounded; matching delivery is best-effort
 * within seconds.
 *
 * The internal route is idempotent (per-leg dedupe via
 * the unique `(lead_inquiry_id, leg_id)` index from
 * PR 1 §13), so a race between the synchronous fire and
 * the cron drain causes no double-notification.
 *
 * On missing `CRON_SECRET`, the helper logs a structured
 * warning + returns without firing — the cron drain will
 * eventually pick up the outbox row (Codex iteration-6
 * P1 #1's replay contract).
 */

export function fireAndForgetMatchTrigger(legId: string): void {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret.trim().length === 0) {
    console.warn(
      '[match-trigger-fire] CRON_SECRET missing; skipping synchronous fire (cron drain will replay)'
    );
    return;
  }

  const siteUrl = resolveSiteUrl();
  const url = `${siteUrl}/api/empty-legs/internal/match-trigger`;

  // No await — fire and forget. The publish form's
  // latency budget excludes the matcher's runtime.
  void fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cronSecret.trim()}`,
    },
    body: JSON.stringify({
      leg_ids: [legId],
      event: 'published',
    }),
    // Vercel functions can have a brief tail latency on
    // sync internal calls; the matcher itself runs in a
    // separate route invocation so we don't need to keep
    // this socket alive long.
    cache: 'no-store',
  }).catch((err) => {
    console.error(
      '[match-trigger-fire] non-blocking fetch error',
      err
    );
  });
}
